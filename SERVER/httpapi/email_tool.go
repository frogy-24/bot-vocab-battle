package httpapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"SERVER/response"
	"SERVER/serverlog"
)

const (
	mailTMBaseURL  = "https://api.mail.tm"
	maxEmailAmount = 100
)

var mailTMHTTPClient = &http.Client{
	Timeout: 30 * time.Second,
}

type createMailTMEmailsRequest struct {
	Amount int `json:"amount"`
}

type mailTMDomainsResponse struct {
	TotalItems int            `json:"hydra:totalItems"`
	Members    []mailTMDomain `json:"hydra:member"`
}

type mailTMDomain struct {
	ID        string `json:"id"`
	Domain    string `json:"domain"`
	IsActive  bool   `json:"isActive"`
	IsPrivate bool   `json:"isPrivate"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type mailTMCreateAccountRequest struct {
	Address  string `json:"address"`
	Password string `json:"password"`
}

type mailTMAccountResponse struct {
	ID         string `json:"id"`
	Address    string `json:"address"`
	Quota      int    `json:"quota"`
	Used       int    `json:"used"`
	IsDisabled bool   `json:"isDisabled"`
	IsDeleted  bool   `json:"isDeleted"`
	CreatedAt  string `json:"createdAt"`
	UpdatedAt  string `json:"updatedAt"`
}

type mailTMTokenResponse struct {
	ID    string `json:"id"`
	Token string `json:"token"`
}

type createdMailTMEmail struct {
	ID       string `json:"id"`
	Address  string `json:"address"`
	Password string `json:"password"`
	Token    string `json:"token"`
	Domain   string `json:"domain"`
}

type failedMailTMEmail struct {
	Index   int    `json:"index"`
	Message string `json:"message"`
}

type createMailTMEmailsResponse struct {
	TotalRequested int                  `json:"total_requested"`
	TotalCreated   int                  `json:"total_created"`
	Emails         []createdMailTMEmail `json:"emails"`
	Failed         []failedMailTMEmail  `json:"failed,omitempty"`
}

type mailTMErrorResponse struct {
	Detail           string `json:"detail"`
	HydraTitle       string `json:"hydra:title"`
	HydraDescription string `json:"hydra:description"`
	Title            string `json:"title"`
	Message          string `json:"message"`
}

func (s *Server) mailTMEmails(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	switch r.Method {
	case http.MethodPost:
		s.createMailTMEmails(w, r)
	default:
		response.WriteJSON(w, http.StatusMethodNotAllowed, response.API{
			Success: false,
			Message: "Method is not supported",
		})
	}
}

func (s *Server) createMailTMEmails(w http.ResponseWriter, r *http.Request) {
	var req createMailTMEmailsRequest

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		serverlog.Warn("POST /mailtm/emails - invalid JSON")
		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: "Invalid JSON",
		})
		return
	}

	if req.Amount <= 0 {
		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: "amount must be greater than 0",
		})
		return
	}

	if req.Amount > maxEmailAmount {
		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: fmt.Sprintf("amount cannot be greater than %d", maxEmailAmount),
		})
		return
	}

	domain, err := getActiveMailTMDomain(r.Context())
	if err != nil {
		serverlog.Error(fmt.Sprintf("POST /mailtm/emails - error getting domain: %v", err))
		response.WriteJSON(w, http.StatusInternalServerError, response.API{
			Success: false,
			Message: fmt.Sprintf("Error getting Mail.tm domain: %v", err),
		})
		return
	}

	result := createMailTMEmailsResponse{
		TotalRequested: req.Amount,
		Emails:         make([]createdMailTMEmail, 0),
		Failed:         make([]failedMailTMEmail, 0),
	}

	for i := 0; i < req.Amount; i++ {
		emailInfo, err := createOneMailTMEmail(r.Context(), domain)
		if err != nil {
			result.Failed = append(result.Failed, failedMailTMEmail{
				Index:   i + 1,
				Message: err.Error(),
			})
			continue
		}

		result.Emails = append(result.Emails, emailInfo)
	}

	result.TotalCreated = len(result.Emails)

	if result.TotalCreated == 0 {
		serverlog.Error("POST /mailtm/emails - no email created")
		response.WriteJSON(w, http.StatusInternalServerError, response.API{
			Success: false,
			Message: "No email was created",
			Data:    result,
		})
		return
	}

	serverlog.Success(fmt.Sprintf(
		"POST /mailtm/emails - created %d/%d emails",
		result.TotalCreated,
		result.TotalRequested,
	))

	response.WriteJSON(w, http.StatusCreated, response.API{
		Success: true,
		Message: fmt.Sprintf("Created %d/%d emails successfully", result.TotalCreated, result.TotalRequested),
		Data:    result,
	})
}

func getActiveMailTMDomain(ctx context.Context) (string, error) {
	var domainResp mailTMDomainsResponse

	if err := callMailTMAPI(ctx, http.MethodGet, "/domains", "", nil, &domainResp); err != nil {
		return "", err
	}

	for _, item := range domainResp.Members {
		if item.IsActive && !item.IsPrivate && strings.TrimSpace(item.Domain) != "" {
			return item.Domain, nil
		}
	}

	return "", fmt.Errorf("no active public domain found")
}

func createOneMailTMEmail(ctx context.Context, domain string) (createdMailTMEmail, error) {
	var lastErr error

	for retry := 0; retry < 3; retry++ {
		address, err := generateMailTMAddress(domain)
		if err != nil {
			return createdMailTMEmail{}, err
		}

		password, err := generateMailTMPassword()
		if err != nil {
			return createdMailTMEmail{}, err
		}

		accountReq := mailTMCreateAccountRequest{
			Address:  address,
			Password: password,
		}

		var accountResp mailTMAccountResponse
		err = callMailTMAPI(ctx, http.MethodPost, "/accounts", "", accountReq, &accountResp)
		if err != nil {
			lastErr = err

			if strings.Contains(strings.ToLower(err.Error()), "already used") {
				continue
			}

			return createdMailTMEmail{}, err
		}

		tokenReq := mailTMCreateAccountRequest{
			Address:  address,
			Password: password,
		}

		var tokenResp mailTMTokenResponse
		if err := callMailTMAPI(ctx, http.MethodPost, "/token", "", tokenReq, &tokenResp); err != nil {
			return createdMailTMEmail{}, err
		}

		return createdMailTMEmail{
			ID:       accountResp.ID,
			Address:  accountResp.Address,
			Password: password,
			Token:    tokenResp.Token,
			Domain:   domain,
		}, nil
	}

	return createdMailTMEmail{}, fmt.Errorf("cannot create unique email after retries: %v", lastErr)
}

func callMailTMAPI(
	ctx context.Context,
	method string,
	path string,
	bearerToken string,
	body interface{},
	out interface{},
) error {
	var reqBody io.Reader

	if body != nil {
		jsonBody, err := json.Marshal(body)
		if err != nil {
			return err
		}

		reqBody = bytes.NewBuffer(jsonBody)
	}

	req, err := http.NewRequestWithContext(ctx, method, mailTMBaseURL+path, reqBody)
	if err != nil {
		return err
	}

	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	if bearerToken != "" {
		req.Header.Set("Authorization", "Bearer "+bearerToken)
	}

	res, err := mailTMHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		bodyBytes, _ := io.ReadAll(res.Body)

		var errResp mailTMErrorResponse
		_ = json.Unmarshal(bodyBytes, &errResp)

		msg := errResp.Detail
		if msg == "" {
			msg = errResp.HydraDescription
		}
		if msg == "" {
			msg = errResp.Message
		}
		if msg == "" {
			msg = string(bodyBytes)
		}

		return fmt.Errorf("mail.tm API error %d: %s", res.StatusCode, msg)
	}

	if out == nil {
		return nil
	}

	return json.NewDecoder(res.Body).Decode(out)
}

func generateMailTMAddress(domain string) (string, error) {
	randomPart, err := randomString(16)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%s@%s", randomPart, domain), nil
}

func randomString(length int) (string, error) {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"

	b := make([]byte, length)
	randomBytes := make([]byte, length)

	if _, err := rand.Read(randomBytes); err != nil {
		return "", err
	}

	for i := range b {
		b[i] = chars[int(randomBytes[i])%len(chars)]
	}

	return string(b), nil
}

func generateMailTMPassword() (string, error) {
	randomPart, err := randomHex(12)
	randomPrefix, err2 := randomString(3)

	if err != nil {
		return "", err
	}
	if err2 != nil {
		return "", err2
	}

	return randomPrefix + randomPart, nil
}

func randomHex(byteLength int) (string, error) {
	b := make([]byte, byteLength)

	if _, err := rand.Read(b); err != nil {
		return "", err
	}

	return hex.EncodeToString(b), nil
}
