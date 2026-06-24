package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type EnglishGuessHint struct {
	WordLength      int    `json:"wordLength"`
	WordMask        string `json:"wordMask"`
	LetterCount     int    `json:"letterCount"`
	ExplanationEN   string `json:"explanation_en"`
	ExampleMaskedEN string `json:"exampleMasked_en"`
	Type            string `json:"type"`
}

type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type ChatCompletionRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	MaxTokens   int           `json:"max_tokens"`
	Stream      bool          `json:"stream"`
}

type ChatCompletionResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		Text string `json:"text"`
	} `json:"choices"`
}

type GuessResult struct {
	Answer     string  `json:"answer"`
	Confidence float64 `json:"confidence"`
	Reason     string  `json:"reason"`
	Raw        string  `json:"raw,omitempty"`
}

func (s *Server) guessWord(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]any{
			"error": "Method not allowed",
		})
		return
	}

	var hint EnglishGuessHint
	if err := json.NewDecoder(r.Body).Decode(&hint); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "Invalid JSON payload",
		})
		return
	}

	hint.WordMask = strings.TrimSpace(hint.WordMask)
	hint.ExplanationEN = strings.TrimSpace(hint.ExplanationEN)
	hint.ExampleMaskedEN = strings.TrimSpace(hint.ExampleMaskedEN)
	hint.Type = strings.TrimSpace(hint.Type)

	if hint.ExplanationEN == "" && hint.ExampleMaskedEN == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "Missing explanation_en or exampleMasked_en",
			"hint":  hint,
		})
		return
	}

	result, err := s.guessWordWithLLM(r.Context(), hint)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{
			"error": err.Error(),
			"hint":  hint,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"guess": result,
	})
}

func (s *Server) guessWordWithLLM(ctx context.Context, hint EnglishGuessHint) (*GuessResult, error) {
	baseURL := getEnv("LLM_BASE_URL", "http://localhost:20128/v1")
	model := getEnv("LLM_MODEL", "oc/deepseek-v4-flash-free")

	reqBody := ChatCompletionRequest{
		Model: model,
		Messages: []ChatMessage{
			{
				Role:    "system",
				Content: `Return only valid JSON. No markdown. No explanation outside JSON.`,
			},
			{
				Role:    "user",
				Content: buildGuessPrompt(hint),
			},
		},
		Temperature: 0,
		MaxTokens:   2048,
		Stream:      false,
	}

	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	url := strings.TrimRight(baseURL, "/") + "/chat/completions"

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewBuffer(bodyBytes))
	if err != nil {
		return nil, err
	}

	httpReq.Header.Set("Content-Type", "application/json")

	if apiKey := strings.TrimSpace(os.Getenv("LLM_API_KEY")); apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	rawBody := strings.TrimSpace(string(respBytes))

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("LLM request failed: status=%d body=%s", resp.StatusCode, limitString(rawBody, 1000))
	}

	content, err := extractLLMContent(respBytes)
	if err != nil {
		return nil, err
	}

	content = cleanLLMJSON(content)

	var guess GuessResult
	if err := json.Unmarshal([]byte(content), &guess); err != nil {
		guess = GuessResult{
			Answer:     strings.ToLower(strings.TrimSpace(content)),
			Confidence: 0,
			Reason:     "Could not parse JSON response from LLM, using raw text as answer",
			Raw:        content,
		}
		return &guess, nil
	}

	guess.Answer = strings.ToLower(strings.TrimSpace(guess.Answer))
	guess.Raw = content

	return &guess, nil
}

func buildGuessPrompt(hint EnglishGuessHint) string {
	return fmt.Sprintf(`Guess the missing English word or phrase.

Clues:
- Word mask: %s
- Word length including spaces: %d
- Letter count excluding spaces: %d
- Type: %s
- English definition: %s
- English masked example: %s

Rules:
1. Use only English clues.
2. The answer must fit the word mask exactly.
3. Underscores represent letters.
4. Spaces in the mask must stay as spaces.
5. If the type is "phrasal verb", the answer may contain a space.
6. Return only one best answer.
7. Return lowercase answer only.
8. Return JSON only in this format:

{
  "answer": "your guess",
  "confidence": 0.95,
  "reason": "short reason in English"
}
`,
		hint.WordMask,
		hint.WordLength,
		hint.LetterCount,
		hint.Type,
		hint.ExplanationEN,
		hint.ExampleMaskedEN,
	)
}

func extractLLMContent(respBytes []byte) (string, error) {
	raw := strings.TrimSpace(string(respBytes))

	// Case 1: OpenAI-compatible response
	var chatResp ChatCompletionResponse
	if err := json.Unmarshal(respBytes, &chatResp); err == nil {
		if len(chatResp.Choices) > 0 {
			content := strings.TrimSpace(chatResp.Choices[0].Message.Content)
			if content != "" {
				return content, nil
			}

			text := strings.TrimSpace(chatResp.Choices[0].Text)
			if text != "" {
				return text, nil
			}
		}
	}

	// Case 2: LLM trả thẳng GuessResult
	var direct GuessResult
	if err := json.Unmarshal(respBytes, &direct); err == nil {
		if strings.TrimSpace(direct.Answer) != "" {
			return raw, nil
		}
	}

	// Case 3: Stream / SSE response dạng data:
	if strings.Contains(raw, "data:") {
		content := extractSSEContent(raw)
		if strings.TrimSpace(content) != "" {
			return content, nil
		}
	}

	return "", fmt.Errorf("cannot parse LLM response. raw body: %s", limitString(raw, 1000))
}

func extractSSEContent(raw string) string {
	var builder strings.Builder

	lines := strings.Split(raw, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)

		if !strings.HasPrefix(line, "data:") {
			continue
		}

		data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if data == "" || data == "[DONE]" {
			continue
		}

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
				Text string `json:"text"`
			} `json:"choices"`
		}

		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		for _, choice := range chunk.Choices {
			if choice.Delta.Content != "" {
				builder.WriteString(choice.Delta.Content)
			}

			if choice.Message.Content != "" {
				builder.WriteString(choice.Message.Content)
			}

			if choice.Text != "" {
				builder.WriteString(choice.Text)
			}
		}
	}

	return strings.TrimSpace(builder.String())
}

func cleanLLMJSON(s string) string {
	s = strings.TrimSpace(s)

	s = strings.TrimPrefix(s, "```json")
	s = strings.TrimPrefix(s, "```")
	s = strings.TrimSuffix(s, "```")

	s = strings.TrimSpace(s)

	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")

	if start >= 0 && end >= 0 && end > start {
		s = s[start : end+1]
	}

	return strings.TrimSpace(s)
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func getEnv(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func limitString(s string, max int) string {
	if len(s) <= max {
		return s
	}

	return s[:max] + "...[truncated]"
}
