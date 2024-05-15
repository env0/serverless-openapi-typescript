interface ObjectType {
    types?: string[];
    children?: ObjectType[];
}

export namespace ProjectApi {
    export type Bool = 'true' | 'false';
    export type Number = number
    export type String = string;
    export type GenericType<T> = T[];
    export namespace Webhooks {
      export type OnCreateWebhook = {
        id: string;
        name: string;
      }
    }
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
            generic: GenericType<{ key: string, name: number}>;
        };
    }

    export namespace DeleteFunc {
        export namespace Request {
            export type Body = {
                id: string;
            };
        }
    }

    export namespace UpdateFunc {
        export namespace Request {
            export type Body = {
                id: string;
                data: string;
            };
        }

        export type Response = {
            id: string;
        };
    }

    export namespace GetFunc {
        export type Response = {
            data: string;
        };
    }
}
