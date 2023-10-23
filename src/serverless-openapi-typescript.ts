import type Serverless from "serverless";
import fs from "fs";
import yaml from "js-yaml";
import {createGenerator, SchemaGenerator} from "ts-json-schema-generator";
import {camelCase, find, get, isArray, isEmpty, kebabCase, mergeWith, set, upperFirst} from "lodash";
import {ApiGatewayEvent} from "serverless/plugins/aws/package/compile/events/apiGateway/lib/validate";
import {mapKeysDeep, mapValuesDeep} from 'deepdash/standalone'

interface Options {
    typescriptApiPath?: string;
    tsconfigPath?: string;
}

type HttpEvent = ApiGatewayEvent['http'] & {
    documentation?: any;
    private?: boolean;
}

export default class ServerlessOpenapiTypeScript {
    private readonly functionsMissingDocumentation: string[];
    private readonly disable: boolean;
    private hooks: { [hook: string]: () => {} };
    private typescriptApiModelPath: string;
    private tsconfigPath: string;
    private schemaGenerator: SchemaGenerator;

    constructor(private serverless: Serverless, private options: Options) {
        this.assertPluginOrder();

        this.initOptions(options);
        this.functionsMissingDocumentation = [];

        if (!this.serverless.service.custom?.documentation) {
            this.log(
                `Disabling OpenAPI generation for ${this.serverless.service.service} - no 'custom.documentation' attribute found`
            );
            this.disable = true;
            delete this.serverless.pluginManager.hooks['openapi:generate:serverless'];
        }

        if (!this.disable) {
            this.hooks = {
                'before:package:createDeploymentArtifacts': this.callOpenApiGenerate.bind(this),
                'before:openapi:generate:serverless': this.populateServerlessWithModels.bind(this),
                'after:openapi:generate:serverless': this.postProcessOpenApi.bind(this)
            };
        }
    }

    initOptions(options) {
        this.options = options || {};
        this.typescriptApiModelPath = this.options.typescriptApiPath || this.serverless.service.custom?.documentation?.typescriptApiPath || 'api.d.ts';
        this.tsconfigPath = this.options.tsconfigPath || this.serverless.service.custom?.documentation?.tsconfigPath || 'tsconfig.json';
    }

    assertPluginOrder() {
        if (!this.serverless.pluginManager.hooks['openapi:generate:serverless']) {
            throw new Error(
                'Please configure your serverless.plugins list so serverless-openapi-typescript will be listed AFTER serverless-openapi-documenter'
            );
        }
    }

    get functions() {
        return this.serverless.service.functions || {};
    }

    log(msg) {
        this.serverless.cli.log(`[serverless-openapi-typescript] ${msg}`);
    }

    async populateServerlessWithModels() {
        this.log('Scanning functions for documentation attribute');
        Object.keys(this.functions).forEach(functionName => {
            this.functions[functionName]?.events?.forEach((event: ApiGatewayEvent) => {
                const httpEvent = event.http as HttpEvent;
                if (httpEvent) {
                    if (httpEvent.documentation) {
                        this.log(`Generating docs for ${functionName}`);

                        this.setModels(httpEvent, functionName);

                        const paths = get(httpEvent, 'request.parameters.paths', []);
                        const querystrings = get(httpEvent, 'request.parameters.querystrings', {});
                        [
                            {params: paths, documentationKey: 'pathParams'},
                            {params: querystrings, documentationKey: 'queryParams'}
                        ].forEach(({params, documentationKey}) => {
                            this.setDefaultParamsDocumentation(params, httpEvent, documentationKey);
                        });
                    } else if (httpEvent.documentation !== null && !httpEvent.private) {
                        this.functionsMissingDocumentation.push(functionName);
                    }
                }
            });
        });

        this.assertAllFunctionsDocumented();
    }

    private callOpenApiGenerate() {
        this.serverless.pluginManager.spawn('openapi:generate');
    }

    assertAllFunctionsDocumented() {
        if (!isEmpty(this.functionsMissingDocumentation)) {
            throw new Error(
                `Some functions have http events which are not documented:
         ${this.functionsMissingDocumentation}
         
        Please add a documentation attribute. 
        If you wish to keep the function undocumented, please explicitly set 
        documentation: ~
         
        `
            );
        }
    }

    setDefaultParamsDocumentation(params, httpEvent, documentationKey) {
        Object.entries(params).forEach(([name, required]) => {
            httpEvent.documentation[documentationKey] = httpEvent.documentation[documentationKey] || [];

            const documentedParams = httpEvent.documentation[documentationKey];
            const existingDocumentedParam = documentedParams.find(documentedParam => documentedParam.name === name);

            if (existingDocumentedParam && typeof existingDocumentedParam.schema === 'string') {
                existingDocumentedParam.schema = this.generateSchema(existingDocumentedParam.schema);
            }

            const paramDocumentationFromSls = {
                name,
                required,
                schema: {type: 'string'}
            };

            if (!existingDocumentedParam) {
                documentedParams.push(paramDocumentationFromSls);
            } else {
                Object.assign(paramDocumentationFromSls, existingDocumentedParam);
                Object.assign(existingDocumentedParam, paramDocumentationFromSls);
            }
        });
    }

    setModels(httpEvent, functionName) {
        const formatName = (model: string): string => upperFirst(camelCase(model.replace(/\W+/g, '')));

        const definitionPrefix = `${this.serverless.service.custom.documentation.apiNamespace}.${upperFirst(camelCase(functionName))}`;
        const method = httpEvent.method.toLowerCase();
        switch (method) {
            case 'delete':
                set(httpEvent, 'documentation.methodResponses', [{
                    statusCode: 204,
                    responseBody: {description: "Mocked response for the delete endpoint."},
                    responseModels:
                        {
                            'application/json': {
                                schema: {
                                    type: "string",
                                    properties: ""
                                }
                            }
                        }

                }]);
                break;
            case 'patch':
            case 'put':
            case 'post':
                const requestModelName = `${definitionPrefix}.Request.Body`;
                this.setModel(requestModelName);
                set(httpEvent, 'documentation.requestModels', {'application/json': requestModelName});
                set(httpEvent, 'documentation.requestBody', {description: ''});

                // Set Request schema validators
                set(httpEvent, 'request.schemas', {
                    'application/json': {
                        name: formatName(requestModelName),
                        schema: this.generateSchema(requestModelName),
                        description: `Generated schema for ${requestModelName}`
                    }
                });
            // no-break;
            case 'get':
                const responseModelName = `${definitionPrefix}.Response`;
                this.setModel(responseModelName);
                set(httpEvent, 'documentation.methodResponses', [
                    {
                        statusCode: 200,
                        responseBody: {description: ''},
                        responseModels: {'application/json': responseModelName}
                    }
                ]);
        }
        const queryParamModel = `${definitionPrefix}.Request.QueryParams`;
        try {
            this.setModel(queryParamModel);
        } catch (e) {
            this.log(`Skipped generation of "${queryParamModel}" - model is missing - will be using the default query param of type string`);
        }

        const pathParamModel = `${definitionPrefix}.Request.PathParams`;
        try {
            this.setModel(pathParamModel);
        } catch (e) {
            this.log(`Skipped generation of "${pathParamModel}" - model is missing - will be using the default path param of type string`);
        }
    }

    postProcessOpenApi() {
        // @ts-ignore
        const outputFile = this.serverless.processedInput.options.output || 'openapi.json';
        const openApi = yaml.load(fs.readFileSync(outputFile));
        this.patchOpenApiVersion(openApi);
        this.enrichMethodsInfo(openApi);
        const encodedOpenAPI = this.encodeOpenApiToStandard(openApi);
        fs.writeFileSync(outputFile, outputFile.endsWith('json') ? JSON.stringify(encodedOpenAPI, null, 2) : yaml.dump(encodedOpenAPI));
    }

    // OpenApi spec define ^[a-zA-Z0-9\.\-_]+$ for legal fields - https://spec.openapis.org/oas/v3.1.0#components-object
    // ts-json-schema-generator - create fields with <,> for generic types and encode them in the ref
    encodeOpenApiToStandard(openApi) {
        const INVALID_CHARACTERS_KEY = /<|>/g;
        const INVALID_CHARACTERS_ENCODED = /%3C|%3E/g; // %3C = <, %3E = >

        const mapObject = mapKeysDeep(openApi, (value, key) =>
            INVALID_CHARACTERS_KEY.test(key) ? key.replace(INVALID_CHARACTERS_KEY, '_') : key
        );

        return mapValuesDeep(mapObject, (value, key) =>
            key === '$ref' && INVALID_CHARACTERS_ENCODED.test(value) ?
                value.replace(INVALID_CHARACTERS_ENCODED, '_') : value
        );
    }

    patchOpenApiVersion(openApi) {
        this.log(`Setting openapi version to 3.1.0`);
        openApi.openapi = '3.1.0';
        return openApi;
    }

    enrichMethodsInfo(openApi) {
        const tagName = openApi.info.title;
        openApi.tags = [
            {
                name: tagName,
                description: openApi.info.description
            }
        ];
        const customTags = this.serverless.service.custom.documentation?.tags;
        if (customTags) openApi.tags = openApi.tags.concat(customTags)

        Object.values(openApi.paths).forEach(path => {
            Object.values(path).forEach(method => {
                const matchingFunction = find(this.functions, (func) => func.name === method.operationId);
                if (matchingFunction) {
                    const httpEvent = matchingFunction.events?.find(
                        (e: ApiGatewayEvent) => e.http
                    ) as ApiGatewayEvent;
                    const http: HttpEvent = httpEvent.http;
                    if (http.documentation?.tag) {
                        method.tags = [http.documentation.tag];
                    } else {
                        method.tags = [tagName];
                    }
                }

                method.operationId = kebabCase(method.operationId);
            });
        });
    }

    setModel(modelName) {
        mergeWith(
            this.serverless.service.custom,
            {
                documentation: {
                    models: [{name: modelName, contentType: 'application/json', schema: this.generateSchema(modelName)}]
                }
            },
            (objValue, srcValue) => {
                if (isArray(objValue)) {
                    return objValue.concat(srcValue);
                }
            }
        );
    }

    generateSchema(modelName) {
        this.log(`Generating schema for ${modelName}`);

        this.schemaGenerator =
            this.schemaGenerator ||
            createGenerator({
                path: this.typescriptApiModelPath,
                tsconfig: this.tsconfigPath,
                type: `*`,
                expose: 'export',
                skipTypeCheck: true,
                topRef: false
            });

        return this.schemaGenerator.createSchema(modelName);
    }
}
