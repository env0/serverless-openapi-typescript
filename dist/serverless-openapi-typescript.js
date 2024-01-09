"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const js_yaml_1 = __importDefault(require("js-yaml"));
const ts_json_schema_generator_1 = require("ts-json-schema-generator");
const lodash_1 = require("lodash");
const standalone_1 = require("deepdash/standalone");
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const child_process_1 = require("child_process");
const execAsync = (0, util_1.promisify)(child_process_1.exec);
class ServerlessOpenapiTypeScript {
    constructor(serverless, options) {
        var _a;
        this.serverless = serverless;
        this.options = options;
        this.assertPluginOrder();
        this.initOptions(options);
        this.functionsMissingDocumentation = [];
        if (!((_a = this.serverless.service.custom) === null || _a === void 0 ? void 0 : _a.documentation)) {
            this.log(`Disabling OpenAPI generation for ${this.serverless.service.service} - no 'custom.documentation' attribute found`);
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
        var _a, _b, _c, _d;
        this.options = options || {};
        this.typescriptApiModelPath = this.options.typescriptApiPath || ((_b = (_a = this.serverless.service.custom) === null || _a === void 0 ? void 0 : _a.documentation) === null || _b === void 0 ? void 0 : _b.typescriptApiPath) || 'api.d.ts';
        this.tsconfigPath = this.options.tsconfigPath || ((_d = (_c = this.serverless.service.custom) === null || _c === void 0 ? void 0 : _c.documentation) === null || _d === void 0 ? void 0 : _d.tsconfigPath) || 'tsconfig.json';
    }
    assertPluginOrder() {
        if (!this.serverless.pluginManager.hooks['openapi:generate:serverless']) {
            throw new Error('Please configure your serverless.plugins list so serverless-openapi-typescript will be listed AFTER serverless-openapi-documenter');
        }
    }
    get functions() {
        return this.serverless.service.functions || {};
    }
    log(msg) {
        this.serverless.cli.log(`[serverless-openapi-typescript] ${msg}`);
    }
    populateServerlessWithModels() {
        return __awaiter(this, void 0, void 0, function* () {
            this.log('Scanning functions for documentation attribute');
            Object.keys(this.functions).forEach(functionName => {
                var _a, _b;
                (_b = (_a = this.functions[functionName]) === null || _a === void 0 ? void 0 : _a.events) === null || _b === void 0 ? void 0 : _b.forEach((event) => {
                    const httpEvent = event.http;
                    if (httpEvent) {
                        if (httpEvent.documentation) {
                            this.log(`Generating docs for ${functionName}`);
                            this.setModels(httpEvent, functionName);
                            const paths = (0, lodash_1.get)(httpEvent, 'request.parameters.paths', []);
                            const querystrings = (0, lodash_1.get)(httpEvent, 'request.parameters.querystrings', {});
                            [
                                { params: paths, documentationKey: 'pathParams' },
                                { params: querystrings, documentationKey: 'queryParams' }
                            ].forEach(({ params, documentationKey }) => {
                                this.setDefaultParamsDocumentation(params, httpEvent, documentationKey);
                            });
                        }
                        else if (httpEvent.documentation !== null && !httpEvent.private) {
                            this.functionsMissingDocumentation.push(functionName);
                        }
                    }
                });
            });
            this.assertAllFunctionsDocumented();
        });
    }
    callOpenApiGenerate() {
        this.serverless.pluginManager.spawn('openapi:generate');
    }
    assertAllFunctionsDocumented() {
        if (!(0, lodash_1.isEmpty)(this.functionsMissingDocumentation)) {
            throw new Error(`Some functions have http events which are not documented:
         ${this.functionsMissingDocumentation}
         
        Please add a documentation attribute. 
        If you wish to keep the function undocumented, please explicitly set 
        documentation: ~
         
        `);
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
                schema: { type: 'string' }
            };
            if (!existingDocumentedParam) {
                documentedParams.push(paramDocumentationFromSls);
            }
            else {
                Object.assign(paramDocumentationFromSls, existingDocumentedParam);
                Object.assign(existingDocumentedParam, paramDocumentationFromSls);
            }
        });
    }
    setModels(httpEvent, functionName) {
        const formatName = (model) => (0, lodash_1.upperFirst)((0, lodash_1.camelCase)(model.replace(/\W+/g, '')));
        const definitionPrefix = `${this.serverless.service.custom.documentation.apiNamespace}.${(0, lodash_1.upperFirst)((0, lodash_1.camelCase)(functionName))}`;
        const method = httpEvent.method.toLowerCase();
        switch (method) {
            case 'delete':
                (0, lodash_1.set)(httpEvent, 'documentation.methodResponses', [{
                        statusCode: 204,
                        responseBody: { description: "Mocked response for the delete endpoint." },
                        responseModels: {
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
                (0, lodash_1.set)(httpEvent, 'documentation.requestModels', { 'application/json': requestModelName });
                (0, lodash_1.set)(httpEvent, 'documentation.requestBody', { description: '' });
                (0, lodash_1.set)(httpEvent, 'request.schemas', {
                    'application/json': {
                        name: formatName(requestModelName),
                        schema: this.generateSchema(requestModelName),
                        description: `Generated schema for ${requestModelName}`
                    }
                });
            case 'get':
                const responseModelName = `${definitionPrefix}.Response`;
                this.setModel(responseModelName);
                (0, lodash_1.set)(httpEvent, 'documentation.methodResponses', [
                    {
                        statusCode: 200,
                        responseBody: { description: '' },
                        responseModels: { 'application/json': responseModelName }
                    }
                ]);
        }
        const queryParamModel = `${definitionPrefix}.Request.QueryParams`;
        try {
            this.setModel(queryParamModel);
        }
        catch (e) {
            this.log(`Skipped generation of "${queryParamModel}" - model is missing - will be using the default query param of type string`);
        }
        const pathParamModel = `${definitionPrefix}.Request.PathParams`;
        try {
            this.setModel(pathParamModel);
        }
        catch (e) {
            this.log(`Skipped generation of "${pathParamModel}" - model is missing - will be using the default path param of type string`);
        }
    }
    postProcessOpenApi() {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            const outputFile = this.serverless.processedInput.options.output || 'openapi.json';
            const openApi = js_yaml_1.default.load(fs_1.default.readFileSync(outputFile));
            this.patchOpenApiVersion(openApi);
            this.enrichMethodsInfo(openApi);
            const encodedOpenAPI = this.encodeOpenApiToStandard(openApi);
            fs_1.default.writeFileSync(outputFile, outputFile.endsWith('json') ? JSON.stringify(encodedOpenAPI, null, 2) : js_yaml_1.default.dump(encodedOpenAPI));
            const s3Bucket = (_a = this.serverless.service.custom.documentation) === null || _a === void 0 ? void 0 : _a.s3Bucket;
            if (s3Bucket) {
                yield this.uploadFileToS3UsingCLI(outputFile, s3Bucket);
            }
        });
    }
    uploadFileToS3UsingCLI(filePath, bucketName) {
        return __awaiter(this, void 0, void 0, function* () {
            const s3Path = `s3://${bucketName}/${path_1.default.basename(filePath)}`;
            try {
                yield execAsync(`aws s3 cp "${filePath}" "${s3Path}"`);
                this.log(`File uploaded successfully to ${s3Path}`);
            }
            catch (error) {
                this.log(`Error uploading file: ${error.message}`);
            }
        });
    }
    encodeOpenApiToStandard(openApi) {
        const INVALID_CHARACTERS_KEY = /<|>/g;
        const INVALID_CHARACTERS_ENCODED = /%3C|%3E/g;
        const mapObject = (0, standalone_1.mapKeysDeep)(openApi, (value, key) => INVALID_CHARACTERS_KEY.test(key) ? key.replace(INVALID_CHARACTERS_KEY, '_') : key);
        return (0, standalone_1.mapValuesDeep)(mapObject, (value, key) => key === '$ref' && INVALID_CHARACTERS_ENCODED.test(value) ?
            value.replace(INVALID_CHARACTERS_ENCODED, '_') : value);
    }
    patchOpenApiVersion(openApi) {
        this.log(`Setting openapi version to 3.1.0`);
        openApi.openapi = '3.1.0';
        return openApi;
    }
    enrichMethodsInfo(openApi) {
        var _a;
        const tagName = openApi.info.title;
        openApi.tags = [
            {
                name: tagName,
                description: openApi.info.description
            }
        ];
        const customTags = (_a = this.serverless.service.custom.documentation) === null || _a === void 0 ? void 0 : _a.tags;
        if (customTags)
            openApi.tags = openApi.tags.concat(customTags);
        Object.values(openApi.paths).forEach(path => {
            Object.values(path).forEach(method => {
                var _a, _b;
                const matchingFunction = (0, lodash_1.find)(this.functions, (func) => func.name === method.operationId);
                if (matchingFunction) {
                    const httpEvent = (_a = matchingFunction.events) === null || _a === void 0 ? void 0 : _a.find((e) => e.http);
                    const http = httpEvent.http;
                    if ((_b = http.documentation) === null || _b === void 0 ? void 0 : _b.tag) {
                        method.tags = [http.documentation.tag];
                    }
                    else {
                        method.tags = [tagName];
                    }
                }
                method.operationId = (0, lodash_1.kebabCase)(method.operationId);
            });
        });
    }
    setModel(modelName) {
        (0, lodash_1.mergeWith)(this.serverless.service.custom, {
            documentation: {
                models: [{ name: modelName, contentType: 'application/json', schema: this.generateSchema(modelName) }]
            }
        }, (objValue, srcValue) => {
            if ((0, lodash_1.isArray)(objValue)) {
                return objValue.concat(srcValue);
            }
        });
    }
    constToEnum(schema) {
        if (typeof schema === "object" && schema !== null) {
            const newSchema = JSON.parse(JSON.stringify(schema));
            if (newSchema.hasOwnProperty("const")) {
                const { const: _ } = newSchema, rest = __rest(newSchema, ["const"]);
                return Object.assign(Object.assign({}, rest), { enum: [newSchema.const] });
            }
            for (const key of Object.keys(newSchema)) {
                newSchema[key] = this.constToEnum(newSchema[key]);
            }
            return newSchema;
        }
        return schema;
    }
    generateSchema(modelName) {
        this.log(`Generating schema for ${modelName}`);
        this.schemaGenerator =
            this.schemaGenerator ||
                (0, ts_json_schema_generator_1.createGenerator)({
                    path: this.typescriptApiModelPath,
                    tsconfig: this.tsconfigPath,
                    type: `*`,
                    expose: 'export',
                    skipTypeCheck: true,
                    topRef: false
                });
        const generatedSchema = this.schemaGenerator.createSchema(modelName);
        return this.constToEnum(generatedSchema);
    }
}
exports.default = ServerlessOpenapiTypeScript;
//# sourceMappingURL=serverless-openapi-typescript.js.map