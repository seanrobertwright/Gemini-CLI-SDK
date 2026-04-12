export class GeminiNotFoundError extends Error {
  constructor(message?: string) {
    super(
      message ??
        'gemini-cli not found. Install it with: npm install -g @google/gemini-cli\n' +
        'Or set GEMINI_BIN_PATH to the path of the gemini binary.'
    );
    this.name = 'GeminiNotFoundError';
  }
}
