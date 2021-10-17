interface ObjectType {
    types?: string[];
    children?: ObjectType[];
}

export namespace ProjectApi {

    export namespace CreateFunc {
        export namespace Request {
            export type Body = {
                data: string;
                statusCode?: number;
                enable: boolean;
                object?: ObjectType;
            };
        }

        export type Response = {
            id: string;
            uuid: string;
        };
    }

    export namespace GetFunc {
        export type Response = {
            data: string;
        };
    }

    export namespace DeleteFunc {
        export namespace Request {
            export type Body = {
                id: string;
            };
        }
    }
}
