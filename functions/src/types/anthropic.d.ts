declare module 'anthropic' {
  export interface TextBlock {
    type: 'text'
    text: string
  }

  export interface MessageContentBlock {
    type: string
    text?: string
  }

  export interface MessageResponse {
    content: MessageContentBlock[]
  }

  export class Client {
    constructor(config: { apiKey: string })
    messages: {
      create(params: Record<string, unknown>): Promise<MessageResponse>
    }
  }
}
