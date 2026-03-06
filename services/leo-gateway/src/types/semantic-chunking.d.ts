declare module 'semantic-chunking' {
    export function chunkit(text: string, options?: Record<string, any>): Promise<any[]>;
}
