"""GeminiNotFoundError — raised when the gemini-cli binary cannot be located."""


class GeminiNotFoundError(Exception):
    """Raised when gemini-cli binary cannot be found."""

    def __init__(self, message: str | None = None) -> None:
        super().__init__(
            message or (
                "gemini-cli not found. Install it with: npm install -g @google/gemini-cli\n"
                "Or set GEMINI_BIN_PATH to the path of the gemini binary."
            )
        )
