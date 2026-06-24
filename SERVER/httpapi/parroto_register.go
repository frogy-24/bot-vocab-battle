package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"SERVER/response"
	"SERVER/serverlog"
)

const (
	firebaseIdentityToolkitBaseURL = "https://identitytoolkit.googleapis.com"

	// Domain này phải được thêm trong Firebase Console:
	// Authentication -> Settings -> Authorized domains
	defaultFirebaseContinueURL = "https://parroto.app"
)

type firebaseSendOobCodeRequest struct {
	Email       string `json:"email"`
	ContinueURL string `json:"continueUrl,omitempty"`
}

type firebaseSendOobCodePayload struct {
	RequestType        string `json:"requestType"`
	Email              string `json:"email"`
	ClientType         string `json:"clientType,omitempty"`
	ContinueURL        string `json:"continueUrl"`
	CanHandleCodeInApp bool   `json:"canHandleCodeInApp"`
}

type firebaseSendOobCodeResponse struct {
	Email string `json:"email"`
	Kind  string `json:"kind,omitempty"`
}

type firebaseErrorResponse struct {
	Error firebaseErrorBody `json:"error"`
}

type firebaseErrorBody struct {
	Code    int                     `json:"code"`
	Message string                  `json:"message"`
	Errors  []firebaseErrorItemBody `json:"errors"`
}

type firebaseErrorItemBody struct {
	Message string `json:"message"`
	Domain  string `json:"domain"`
	Reason  string `json:"reason"`
}

func (s *Server) firebaseSendOobCode(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	switch r.Method {
	case http.MethodPost:
		s.sendFirebaseEmailSignInCode(w, r)
	default:
		response.WriteJSON(w, http.StatusMethodNotAllowed, response.API{
			Success: false,
			Message: "Method is not supported",
		})
	}
}

func (s *Server) sendFirebaseEmailSignInCode(w http.ResponseWriter, r *http.Request) {
	var req firebaseSendOobCodeRequest

	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(&req); err != nil {
		serverlog.Warn("POST /firebase/send-oob-code - invalid JSON")
		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: "Invalid JSON",
		})
		return
	}

	req.Email = strings.TrimSpace(req.Email)
	req.ContinueURL = strings.TrimSpace(req.ContinueURL)

	if req.Email == "" {
		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: "email cannot be empty",
		})
		return
	}

	if !isValidEmailBasic(req.Email) {
		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: "email is invalid",
		})
		return
	}

	apiKey := strings.TrimSpace(getEnv("FIREBASE_API_KEY", "AIzaSyDy3B5322OwrvTKzufs6fU2gS23F6l_7e0"))
	if apiKey == "" {
		serverlog.Error("POST /firebase/send-oob-code - FIREBASE_API_KEY is empty")
		response.WriteJSON(w, http.StatusInternalServerError, response.API{
			Success: false,
			Message: "FIREBASE_API_KEY is not configured",
		})
		return
	}

	continueURL := resolveFirebaseContinueURL(req.ContinueURL)

	if err := validateFirebaseContinueURL(continueURL); err != nil {
		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: err.Error(),
		})
		return
	}

	payload := firebaseSendOobCodePayload{
		RequestType:        "EMAIL_SIGNIN",
		Email:              req.Email,
		ClientType:         "CLIENT_TYPE_WEB",
		ContinueURL:        continueURL,
		CanHandleCodeInApp: true,
	}

	var firebaseResp firebaseSendOobCodeResponse

	if err := callFirebaseIdentityToolkitAPI(
		r.Context(),
		"/v1/accounts:sendOobCode",
		apiKey,
		payload,
		&firebaseResp,
	); err != nil {
		serverlog.Error(fmt.Sprintf("POST /firebase/send-oob-code - error sending email=%s: %v", req.Email, err))
		response.WriteJSON(w, http.StatusInternalServerError, response.API{
			Success: false,
			Message: fmt.Sprintf("Error sending Firebase OOB code: %v", err),
		})
		return
	}

	serverlog.Success(fmt.Sprintf("POST /firebase/send-oob-code - sent EMAIL_SIGNIN to email=%s", req.Email))

	response.WriteJSON(w, http.StatusOK, response.API{
		Success: true,
		Message: "Firebase email sign-in code sent successfully",
		Data:    firebaseResp,
	})
}

func callFirebaseIdentityToolkitAPI(
	ctx context.Context,
	path string,
	apiKey string,
	body interface{},
	out interface{},
) error {
	jsonBody, err := json.Marshal(body)
	if err != nil {
		return err
	}

	endpoint := fmt.Sprintf(
		"%s%s?key=%s",
		firebaseIdentityToolkitBaseURL,
		path,
		url.QueryEscape(apiKey),
	)

	httpReq, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint,
		bytes.NewBuffer(jsonBody),
	)
	if err != nil {
		return err
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	res, err := mailTMHTTPClient.Do(httpReq)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	bodyBytes, readErr := io.ReadAll(res.Body)
	if readErr != nil {
		return readErr
	}

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var firebaseErr firebaseErrorResponse
		_ = json.Unmarshal(bodyBytes, &firebaseErr)

		msg := firebaseErr.Error.Message
		if msg == "" {
			msg = string(bodyBytes)
		}

		return fmt.Errorf("firebase API error %d: %s", res.StatusCode, msg)
	}

	if out == nil {
		return nil
	}

	if len(bodyBytes) == 0 {
		return nil
	}

	if err := json.Unmarshal(bodyBytes, out); err != nil {
		return fmt.Errorf("cannot parse Firebase response: %w - body=%s", err, string(bodyBytes))
	}

	return nil
}

func resolveFirebaseContinueURL(requestContinueURL string) string {
	if requestContinueURL != "" {
		return requestContinueURL
	}

	envContinueURL := strings.TrimSpace(getEnv("FIREBASE_CONTINUE_URL", "https://parroto.app"))
	if envContinueURL != "" {
		return envContinueURL
	}

	return defaultFirebaseContinueURL
}

func validateFirebaseContinueURL(rawURL string) error {
	if rawURL == "" {
		return fmt.Errorf("continueUrl cannot be empty")
	}

	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("continueUrl is invalid")
	}

	if parsedURL.Scheme != "https" && parsedURL.Scheme != "http" {
		return fmt.Errorf("continueUrl must start with http:// or https://")
	}

	if parsedURL.Hostname() == "" {
		return fmt.Errorf("continueUrl host is empty")
	}

	// Chặn lỗi hay gặp nhất:
	// Không được lấy identitytoolkit.googleapis.com làm continueUrl.
	if strings.EqualFold(parsedURL.Hostname(), "identitytoolkit.googleapis.com") {
		return fmt.Errorf("continueUrl cannot be identitytoolkit.googleapis.com; use your app domain, for example https://parroto.app")
	}

	return nil
}

func isValidEmailBasic(email string) bool {
	email = strings.TrimSpace(email)

	if email == "" {
		return false
	}

	if strings.Count(email, "@") != 1 {
		return false
	}

	parts := strings.Split(email, "@")
	local := parts[0]
	domain := parts[1]

	if local == "" || domain == "" {
		return false
	}

	if strings.ContainsAny(email, " \n\r\t") {
		return false
	}

	if !strings.Contains(domain, ".") {
		return false
	}

	return true
}
