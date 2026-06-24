package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"SERVER/response"
	"SERVER/serverlog"
)

type firebaseVerifyTokenRequest struct {
	IDToken string `json:"idToken"`
}

type firebaseLookupPayload struct {
	IDToken string `json:"idToken"`
}

type firebaseLookupResponse struct {
	Kind  string               `json:"kind"`
	Users []firebaseLookupUser `json:"users"`
}

type firebaseLookupUser struct {
	LocalID          string                     `json:"localId"`
	Email            string                     `json:"email"`
	EmailVerified    bool                       `json:"emailVerified"`
	ProviderUserInfo []firebaseProviderUserInfo `json:"providerUserInfo"`
	ValidSince       string                     `json:"validSince"`
	LastLoginAt      string                     `json:"lastLoginAt"`
	CreatedAt        string                     `json:"createdAt"`
	EmailLinkSignin  bool                       `json:"emailLinkSignin"`
	LastRefreshAt    string                     `json:"lastRefreshAt"`
	Disabled         bool                       `json:"disabled,omitempty"`
}

type firebaseProviderUserInfo struct {
	ProviderID  string `json:"providerId"`
	FederatedID string `json:"federatedId"`
	Email       string `json:"email"`
	RawID       string `json:"rawId"`
}

func (s *Server) firebaseVerifyToken(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	switch r.Method {
	case http.MethodPost:
		s.verifyFirebaseIDToken(w, r)
	default:
		response.WriteJSON(w, http.StatusMethodNotAllowed, response.API{
			Success: false,
			Message: "Method is not supported",
		})
	}
}

func (s *Server) verifyFirebaseIDToken(w http.ResponseWriter, r *http.Request) {
	var req firebaseVerifyTokenRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		serverlog.Warn("POST /firebase/verify-token - invalid JSON")

		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: "Invalid JSON",
		})
		return
	}

	req.IDToken = strings.TrimSpace(req.IDToken)

	if req.IDToken == "" {
		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: "idToken cannot be empty",
		})
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	result, statusCode, err := callFirebaseLookup(ctx, req.IDToken)
	if err != nil {
		serverlog.Error(fmt.Sprintf("POST /firebase/verify-token - Firebase lookup error: %v", err))

		response.WriteJSON(w, statusCode, response.API{
			Success: false,
			Message: fmt.Sprintf("Firebase verify failed: %v", err),
		})
		return
	}

	if len(result.Users) == 0 {
		response.WriteJSON(w, http.StatusUnauthorized, response.API{
			Success: false,
			Message: "Token is valid but no user was returned",
		})
		return
	}

	user := result.Users[0]

	serverlog.Success(fmt.Sprintf(
		"POST /firebase/verify-token - verified email=%s localId=%s emailVerified=%v",
		user.Email,
		user.LocalID,
		user.EmailVerified,
	))

	response.WriteJSON(w, http.StatusOK, response.API{
		Success: true,
		Message: "Token verified successfully",
		Data: map[string]interface{}{
			"kind":  result.Kind,
			"user":  user,
			"users": result.Users,
		},
	})
}

func callFirebaseLookup(
	ctx context.Context,
	idToken string,
) (*firebaseLookupResponse, int, error) {
	apiKey := strings.TrimSpace(os.Getenv("FIREBASE_API_KEY"))
	if apiKey == "" {
		apiKey = defaultFirebaseAPIKey
	}

	endpoint := "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" + url.QueryEscape(apiKey)

	payload := firebaseLookupPayload{
		IDToken: idToken,
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

	var result firebaseLookupResponse
	if err := json.Unmarshal(resBody, &result); err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("cannot decode Firebase lookup response: %w", err)
	}

	return &result, http.StatusOK, nil
}
