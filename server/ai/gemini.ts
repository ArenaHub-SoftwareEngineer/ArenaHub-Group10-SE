// Gemini through @google/genai: streaming, function calling, and JSON output for bracket drafts.
// The whole model turn (including thought signatures) is sent back with the tool results, as the API requires.
import { FunctionCallingConfigMode, GoogleGenAI, type Content, type FunctionCall, type Part } from '@google/genai';
import { MAX_TOOL_ROUNDS, runTool, toolOutput, type Provider } from './provider.ts';

export function geminiProvider(apiKey: string, model: string): Provider {
  const client = new GoogleGenAI({ apiKey });
  return {
    id: 'gemini',
    model,
    async *stream(request) {
      const contents: Content[] = [
        ...request.history.map(item => ({ role: item.role === 'assistant' ? 'model' : 'user', parts: [{ text: item.text }] })),
        { role: 'user', parts: [{ text: request.question }] },
      ];
      const functionDeclarations = request.tools.map(t => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters }));
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const last = round === MAX_TOOL_ROUNDS - 1;
        const stream = await client.models.generateContentStream({
          model, contents,
          config: {
            systemInstruction: request.system, temperature: 0.2, maxOutputTokens: request.maxOutputTokens,
            abortSignal: request.signal, httpOptions: { timeout: 30_000 },
            ...(functionDeclarations.length ? {
              tools: [{ functionDeclarations }],
              toolConfig: { functionCallingConfig: { mode: last ? FunctionCallingConfigMode.NONE : FunctionCallingConfigMode.AUTO } },
            } : {}),
          },
        });
        const parts: Part[] = [], calls: FunctionCall[] = [];
        for await (const chunk of stream) {
          for (const part of chunk.candidates?.[0]?.content?.parts || []) {
            parts.push(part);
            if (part.functionCall) calls.push(part.functionCall);
            else if (part.text && !part.thought) yield part.text;
          }
        }
        if (!calls.length) return;
        contents.push({ role: 'model', parts });
        const responses = await Promise.all(calls.map(async call => ({
          functionResponse: { ...(call.id ? { id: call.id } : {}), name: call.name, response: { output: JSON.parse(toolOutput(await runTool(request.tools, call.name, call.args))) } },
        })));
        contents.push({ role: 'user', parts: responses });
      }
    },
    async json(request) {
      const result = await client.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
        config: { systemInstruction: request.system, temperature: 0, maxOutputTokens: 2000, responseMimeType: 'application/json', responseJsonSchema: request.schema, abortSignal: request.signal, httpOptions: { timeout: 30_000 } },
      });
      return JSON.parse(result.text || 'null');
    },
  };
}
