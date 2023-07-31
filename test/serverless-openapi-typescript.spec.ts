import Serverless from "serverless";
import path from "path";
import fs from "fs";
import {promisify} from "util";
import yaml from "js-yaml";

const readFileAsync = promisify(fs.readFile);
const deleteFileAsync = promisify(fs.unlink);
const existsAsync = promisify(fs.exists);

jest.setTimeout(60000);

describe('ServerlessOpenapiTypeScript', () => {
    describe.each`
    testCase         | projectName
    ${'Custom Tags'}  | ${'custom-tags'}
    ${'Hyphenated Functions'}  | ${'hyphenated-functions'}
    ${'Full Project'} | ${'full'}
    `('when using $testCase', ({projectName}) => {

        jest.mock('uuid');

        beforeEach(async () => {
            await deleteOutputFile(projectName);
        });

        it('should create the expected file', async () => {
            await runOpenApiGenerate(projectName);

            await assertYamlFilesEquals(projectName);
        });
    });

    describe('WithoutOpenAPI', () => {
        const projectName = 'without-openapi';

        it('should throw an error when serverless-openapi-documentation not loaded before', async () => {
            await expect(runOpenApiGenerate(projectName)).rejects.toEqual(new Error('Please configure your serverless.plugins list so serverless-openapi-typescript will be listed AFTER serverless-openapi-documenter'));
        });
    });

    describe('NotDocumented', () => {
        const projectName = 'not-documented';

        it('should throw an error when found function not documented', async () => {
            await expect(runOpenApiGenerate(projectName)).rejects.toEqual(expect.objectContaining({message: expect.stringContaining('deleteFunc')}));
        });
    });

    describe('TypeMissing', () => {
        const projectName = 'type-missing';

        it('should throw an error when type is missing', async () => {
            await expect(runOpenApiGenerate(projectName)).rejects.toEqual(new Error('No root type "ProjectApi.CreateFunc.Request.Body" found'));
        });
    });

    describe('Disable', () => {
        const projectName = 'disable';

        it('should not create docs', async () => {
            await runOpenApiGenerate(projectName);

            await expect(existsAsync(`test/fixtures/expect-openapi-${projectName}.yml`)).resolves.toBeFalsy();
        });
    });
});

async function assertYamlFilesEquals(projectName: string): Promise<void> {
    const outputFile = `openapi-${projectName}.yml`;
    const expectFile = `test/fixtures/expect-openapi-${projectName}.yml`;

    const [expectOutput, actualOutput] = await Promise.all([processYamlFileForTest(expectFile), processYamlFileForTest(outputFile)]);
    expect(actualOutput).toEqual(expectOutput);
}

async function processYamlFileForTest(path: string): Promise<string> {
    const yamlData = await readYaml(path);
    delete yamlData.info.version;
    return yaml.dump(yamlData);
}

async function readYaml(path: string) {
    const data = await readFileAsync(path);
    return yaml.load(data);
}

async function deleteOutputFile(project) {
    try {
        await deleteFileAsync(`openapi-${project}.yml`);
    } catch {
    }
}

async function runOpenApiGenerate(projectName) {
    const projectPath = path.join(__dirname, `serverless-${projectName}`);
    const serverlessYamlPath = path.join(projectPath, "resources/serverless.yml");
    const typescriptApiPath = path.join(projectPath, "api.d.ts");
    const outputFile = `openapi-${projectName}.yml`;

    const config = await readYaml(serverlessYamlPath);
    const sls = new Serverless({
        configurationPath: serverlessYamlPath,
        configuration: config,
        commands: ['openapi', 'generate'],
        options: {
            typescriptApiPath,
            output: outputFile
        }
    });

    await sls.init();
    await sls.run();
}
