interface ObjectType {
    types?: string[];
    children?: string[];
}

export namespace ProjectApi {
    export type GenericType<T> = T[];

    export namespace CreateFunc {
        export namespace Request {
            export type Body = {
                data: string;
                statusCode?: number;
                enable: boolean;
                object?: ObjectType;
                replace: 'TEST'
            };
        }

        export type Response = {
            id: string;
            uuid: string;
            generic: GenericType<{ key: string, name: number}>;
        };
    }
}
