package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"SERVER/response"
	"SERVER/serverlog"
)

type mailTMMessagesResponse struct {
	Context    string              `json:"@context,omitempty"`
	HydraID    string              `json:"@id,omitempty"`
	Type       string              `json:"@type,omitempty"`
	TotalItems int                 `json:"hydra:totalItems"`
	Members    []mailTMMessageItem `json:"hydra:member"`
}

type mailTMMessageAddress struct {
	Address string `json:"address"`
	Name    string `json:"name"`
}

type mailTMMessageItem struct {
	ID             string                 `json:"id"`
	AccountID      string                 `json:"accountId"`
	MsgID          string                 `json:"msgid"`
	From           mailTMMessageAddress   `json:"from"`
	To             []mailTMMessageAddress `json:"to"`
	Subject        string                 `json:"subject"`
	Intro          string                 `json:"intro"`
	Seen           bool                   `json:"seen"`
	IsDeleted      bool                   `json:"isDeleted"`
	HasAttachments bool                   `json:"hasAttachments"`
	Size           int                    `json:"size"`
	DownloadURL    string                 `json:"downloadUrl"`
	CreatedAt      string                 `json:"createdAt"`
	UpdatedAt      string                 `json:"updatedAt"`
}

type mailTMAttachment struct {
	ID               string `json:"id"`
	Filename         string `json:"filename"`
	ContentType      string `json:"contentType"`
	Disposition      string `json:"disposition"`
	TransferEncoding string `json:"transferEncoding"`
	Related          bool   `json:"related"`
	Size             int    `json:"size"`
	DownloadURL      string `json:"downloadUrl"`
}

type mailTMMessageDetail struct {
	ID             string                 `json:"id"`
	AccountID      string                 `json:"accountId"`
	MsgID          string                 `json:"msgid"`
	From           mailTMMessageAddress   `json:"from"`
	To             []mailTMMessageAddress `json:"to"`
	CC             []mailTMMessageAddress `json:"cc,omitempty"`
	BCC            []mailTMMessageAddress `json:"bcc,omitempty"`
	Subject        string                 `json:"subject"`
	Intro          string                 `json:"intro"`
	Text           interface{}            `json:"text"`
	HTML           []string               `json:"html"`
	Seen           bool                   `json:"seen"`
	Flagged        bool                   `json:"flagged"`
	IsDeleted      bool                   `json:"isDeleted"`
	HasAttachments bool                   `json:"hasAttachments"`
	Attachments    []mailTMAttachment     `json:"attachments"`
	Size           int                    `json:"size"`
	DownloadURL    string                 `json:"downloadUrl"`
	CreatedAt      string                 `json:"createdAt"`
	UpdatedAt      string                 `json:"updatedAt"`
}

func (s *Server) mailTMMessages(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	switch r.Method {
	case http.MethodGet:
		s.getMailTMMessages(w, r)
	default:
		response.WriteJSON(w, http.StatusMethodNotAllowed, response.API{
			Success: false,
			Message: "Method is not supported",
		})
	}
}

func (s *Server) getMailTMMessages(w http.ResponseWriter, r *http.Request) {
	token, ok := getBearerTokenFromRequest(r)
	if !ok {
		serverlog.Warn("GET /mailtm/messages - missing Authorization Bearer token")

		response.WriteJSON(w, http.StatusUnauthorized, response.API{
			Success: false,
			Message: "Missing Authorization Bearer token",
		})
		return
	}

	messageID := strings.TrimSpace(r.URL.Query().Get("id"))

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()

	if messageID != "" {
		s.getMailTMMessageDetail(w, r, ctx, token, messageID)
		return
	}

	body, statusCode, err := callMailTMGetRaw(ctx, token, "/messages")
	if err != nil {
		serverlog.Error(fmt.Sprintf("GET /mailtm/messages - error loading messages: %v", err))

		response.WriteJSON(w, statusCode, response.API{
			Success: false,
			Message: fmt.Sprintf("Error loading messages: %v", err),
		})
		return
	}

	messages, total, err := decodeMailTMMessages(body)
	if err != nil {
		serverlog.Error(fmt.Sprintf("GET /mailtm/messages - decode error: %v", err))

		response.WriteJSON(w, http.StatusInternalServerError, response.API{
			Success: false,
			Message: fmt.Sprintf("Error loading messages: %v", err),
		})
		return
	}

	serverlog.Info(fmt.Sprintf("GET /mailtm/messages - returned %d messages", len(messages)))

	response.WriteJSON(w, http.StatusOK, response.API{
		Success: true,
		Message: "Messages loaded successfully",
		Data: map[string]interface{}{
			"total":    total,
			"messages": messages,
		},
	})
}

func (s *Server) getMailTMMessageDetail(
	w http.ResponseWriter,
	r *http.Request,
	ctx context.Context,
	token string,
	messageID string,
) {
	messageID = strings.TrimSpace(messageID)

	if messageID == "" {
		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: "message id cannot be empty",
		})
		return
	}

	var detail mailTMMessageDetail

	statusCode, err := callMailTMGet(ctx, token, "/messages/"+messageID, &detail)
	if err != nil {
		serverlog.Error(fmt.Sprintf("GET /mailtm/messages?id=%s - error loading message detail: %v", messageID, err))

		response.WriteJSON(w, statusCode, response.API{
			Success: false,
			Message: fmt.Sprintf("Error loading message detail: %v", err),
		})
		return
	}

	serverlog.Info(fmt.Sprintf("GET /mailtm/messages?id=%s - loaded message detail", messageID))

	response.WriteJSON(w, http.StatusOK, response.API{
		Success: true,
		Message: "Message detail loaded successfully",
		Data:    detail,
	})
}

func getBearerTokenFromRequest(r *http.Request) (string, bool) {
	authHeader := strings.TrimSpace(r.Header.Get("Authorization"))
	if authHeader == "" {
		return "", false
	}

	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 {
		return "", false
	}

	if !strings.EqualFold(parts[0], "Bearer") {
		return "", false
	}

	token := strings.TrimSpace(parts[1])
	if token == "" {
		return "", false
	}

	return token, true
}

func decodeMailTMMessages(body []byte) ([]mailTMMessageItem, int, error) {
	// Trường hợp 1: mail.tm trả về array:
	// [
	//   { "id": "...", "subject": "..." }
	// ]
	var arrayResp []mailTMMessageItem
	if err := json.Unmarshal(body, &arrayResp); err == nil {
		return arrayResp, len(arrayResp), nil
	}

	// Trường hợp 2: mail.tm trả về Hydra object:
	// {
	//   "hydra:totalItems": 1,
	//   "hydra:member": [...]
	// }
	var hydraResp mailTMMessagesResponse
	if err := json.Unmarshal(body, &hydraResp); err == nil {
		total := hydraResp.TotalItems
		if total == 0 {
			total = len(hydraResp.Members)
		}

		return hydraResp.Members, total, nil
	}

	return nil, 0, fmt.Errorf("cannot decode mail.tm messages response: %s", string(body))
}

func callMailTMGetRaw(ctx context.Context, token string, path string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, getEnv("MAILTM_API_URL", "https://api.mail.tm")+path, nil)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")

	client := &http.Client{
		Timeout: 30 * time.Second,
	}

	res, err := client.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	defer res.Body.Close()

	body, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, res.StatusCode, fmt.Errorf("mail.tm returned status %d: %s", res.StatusCode, string(body))
	}

	if len(body) == 0 {
		return nil, http.StatusInternalServerError, fmt.Errorf("mail.tm returned empty response")
	}

	return body, http.StatusOK, nil
}

func callMailTMGet(ctx context.Context, token string, path string, target interface{}) (int, error) {
	body, statusCode, err := callMailTMGetRaw(ctx, token, path)
	if err != nil {
		return statusCode, err
	}

	if err := json.Unmarshal(body, target); err != nil {
		return http.StatusInternalServerError, fmt.Errorf("cannot decode mail.tm response: %w", err)
	}

	return http.StatusOK, nil
}
