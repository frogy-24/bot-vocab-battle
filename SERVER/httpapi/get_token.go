package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"SERVER/response"
	"SERVER/serverlog"
)

const defaultFirebaseAPIKey = "AIzaSyDy3B5322OwrvTKzufs6fU2gS23F6l_7e0"

type emailLinkSignInRequest struct {
	Email      string   `json:"email"`
	OOBCode    string   `json:"oobCode,omitempty"`
	Link       string   `json:"link,omitempty"`
	SignInLink string   `json:"signInLink,omitempty"`
	Text       string   `json:"text,omitempty"`
	HTML       []string `json:"html,omitempty"`
}

type firebaseEmailLinkPayload struct {
	Email   string `json:"email"`
	OOBCode string `json:"oobCode"`
}

type firebaseEmailLinkResponse struct {
	Kind         string `json:"kind"`
	IDToken      string `json:"idToken"`
	Email        string `json:"email"`
	RefreshToken string `json:"refreshToken"`
	ExpiresIn    string `json:"expiresIn"`
	LocalID      string `json:"localId"`
	IsNewUser    bool   `json:"isNewUser"`
}

func (s *Server) firebaseSignInWithEmailLink(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	switch r.Method {
	case http.MethodPost:
		s.signInWithEmailLink(w, r)
	default:
		response.WriteJSON(w, http.StatusMethodNotAllowed, response.API{
			Success: false,
			Message: "Method is not supported",
		})
	}
}

func (s *Server) signInWithEmailLink(w http.ResponseWriter, r *http.Request) {
	var req emailLinkSignInRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		serverlog.Warn("POST /firebase/sign-in-email-link - invalid JSON")

		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: "Invalid JSON",
		})
		return
	}

	req.Email = strings.TrimSpace(req.Email)
	req.OOBCode = strings.TrimSpace(req.OOBCode)

	if req.Email == "" {
		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: "email cannot be empty",
		})
		return
	}

	oobCode, err := extractOOBCodeFromRequest(req)
	if err != nil {
		serverlog.Warn(fmt.Sprintf("POST /firebase/sign-in-email-link - cannot extract oobCode: %v", err))

		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: err.Error(),
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	result, statusCode, err := callFirebaseEmailLinkSignIn(ctx, req.Email, oobCode)
	if err != nil {
		serverlog.Error(fmt.Sprintf("POST /firebase/sign-in-email-link - Firebase error email=%s: %v", req.Email, err))

		response.WriteJSON(w, statusCode, response.API{
			Success: false,
			Message: fmt.Sprintf("Firebase sign in failed: %v", err),
		})
		return
	}

	serverlog.Success(fmt.Sprintf(
		"POST /firebase/sign-in-email-link - signed in email=%s localId=%s isNewUser=%v",
		result.Email,
		result.LocalID,
		result.IsNewUser,
	))

	response.WriteJSON(w, http.StatusOK, response.API{
		Success: true,
		Message: "Sign in with email link successfully",
		Data:    result,
	})
}

func extractOOBCodeFromRequest(req emailLinkSignInRequest) (string, error) {
	if strings.TrimSpace(req.OOBCode) != "" {
		return strings.TrimSpace(req.OOBCode), nil
	}

	candidates := []string{
		req.Link,
		req.SignInLink,
		req.Text,
	}

	for _, htmlPart := range req.HTML {
		candidates = append(candidates, htmlPart)
	}

	for _, raw := range candidates {
		code := extractOOBCodeFromString(raw)
		if code != "" {
			return code, nil
		}
	}

	return "", fmt.Errorf("oobCode not found. Please provide oobCode or email link/html containing oobCode")
}

func extractOOBCodeFromString(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}

	decoded := html.UnescapeString(raw)

	// Case 1: raw là URL đầy đủ.
	if strings.HasPrefix(decoded, "http://") || strings.HasPrefix(decoded, "https://") {
		if code := extractOOBCodeFromURL(decoded); code != "" {
			return code
		}
	}

	// Case 2: raw là HTML/text chứa URL.
	urlRegex := regexp.MustCompile(`https?://[^\s"'<>]+`)
	urls := urlRegex.FindAllString(decoded, -1)

	for _, link := range urls {
		if code := extractOOBCodeFromURL(link); code != "" {
			return code
		}
	}

	// Case 3: fallback bắt trực tiếp oobCode=... trong chuỗi.
	codeRegex := regexp.MustCompile(`(?:\?|&|&amp;)oobCode=([^&\s"'<>]+)`)
	matches := codeRegex.FindStringSubmatch(decoded)
	if len(matches) >= 2 {
		code, _ := url.QueryUnescape(matches[1])
		return strings.TrimSpace(code)
	}

	return ""
}

func extractOOBCodeFromURL(rawURL string) string {
	rawURL = strings.TrimSpace(html.UnescapeString(rawURL))
	if rawURL == "" {
		return ""
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}

	code := strings.TrimSpace(parsed.Query().Get("oobCode"))
	if code == "" {
		return ""
	}

	return code
}

func callFirebaseEmailLinkSignIn(
	ctx context.Context,
	email string,
	oobCode string,
) (*firebaseEmailLinkResponse, int, error) {
	apiKey := strings.TrimSpace(os.Getenv("FIREBASE_API_KEY"))
	if apiKey == "" {
		apiKey = defaultFirebaseAPIKey
	}

	endpoint := "https://identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink?key=" + url.QueryEscape(apiKey)

	payload := firebaseEmailLinkPayload{
		Email:   email,
		OOBCode: oobCode,
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	res, err := client.Do(httpReq)
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	defer res.Body.Close()

	resBody, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, res.StatusCode, fmt.Errorf("firebase returned status %d: %s", res.StatusCode, string(resBody))
	}

	var result firebaseEmailLinkResponse
	if err := json.Unmarshal(resBody, &result); err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("cannot decode Firebase response: %w", err)
	}

	if strings.TrimSpace(result.IDToken) == "" || strings.TrimSpace(result.RefreshToken) == "" {
		return nil, http.StatusInternalServerError, fmt.Errorf("Firebase response missing idToken or refreshToken")
	}

	return &result, http.StatusOK, nil
}
