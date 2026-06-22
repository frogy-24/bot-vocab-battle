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
	"time"
)

type CheckInRequest struct {
	Timezone string `json:"timezone"`
}

type CheckInResponse struct {
	Status  string      `json:"status"`
	Message string      `json:"message"`
	Data    CheckInData `json:"data"`
}

type CheckInData struct {
	CurrentStreak       int     `json:"current_streak"`
	MaxStreak           int     `json:"max_streak"`
	FreezeCount         int     `json:"freeze_count"`
	FreezeUsed          bool    `json:"freeze_used"`
	DailyRewardDiamonds int     `json:"daily_reward_diamonds"`
	MilestoneReached    *string `json:"milestone_reached"`
	AlreadyCountedToday bool    `json:"already_counted_today"`
}

type CheckInError struct {
	StatusCode int         `json:"status_code"`
	Data       interface{} `json:"data,omitempty"`
	Message    string      `json:"message"`
}

func (e *CheckInError) Error() string {
	return e.Message
}

type BattleActivityResponse struct {
	Status  string             `json:"status"`
	Message string             `json:"message"`
	Data    BattleActivityData `json:"data"`
}

type BattleActivityData struct {
	ID                string `json:"_id"`
	UserID            string `json:"userId"`
	Version           int    `json:"__v"`
	CreatedAt         string `json:"createdAt"`
	UpdatedAt         string `json:"updatedAt"`
	LastPlayedAt      string `json:"lastPlayedAt"`
	ELO               int    `json:"elo"`
	TotalDiamondsLost int    `json:"totalDiamondsLost"`
	TotalDiamondsWon  int    `json:"totalDiamondsWon"`
	TotalDraws        int    `json:"totalDraws"`
	TotalGames        int    `json:"totalGames"`
	TotalLosses       int    `json:"totalLosses"`
	TotalRoundsWon    int    `json:"totalRoundsWon"`
	TotalWins         int    `json:"totalWins"`
}

type BattleActivityError struct {
	StatusCode int         `json:"status_code"`
	Data       interface{} `json:"data,omitempty"`
	Message    string      `json:"message"`
}

func (e *BattleActivityError) Error() string {
	return e.Message
}

func (s *Server) checkIn(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{
			"status":  "error",
			"message": "method not allowed",
		})
		return
	}

	authHeader := r.Header.Get("Authorization")
	timezone := r.Header.Get("X-User-Timezone")

	if timezone == "" {
		timezone = "Asia/Saigon"
	}

	checkInResult, err := CheckInStreak(r.Context(), authHeader, timezone)
	if err != nil {
		if checkErr, ok := err.(*CheckInError); ok {
			writeJSON(w, checkErr.StatusCode, map[string]interface{}{
				"status":  "error",
				"message": checkErr.Message,
				"data":    checkErr.Data,
			})
			return
		}

		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"status":  "error",
			"message": err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, checkInResult)
}

func (s *Server) battleActivity(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]interface{}{
			"status":  "error",
			"message": "method not allowed",
		})
		return
	}

	userID := strings.TrimSpace(r.URL.Query().Get("userId"))
	if userID == "" {
		writeJSON(w, http.StatusBadRequest, map[string]interface{}{
			"status":  "error",
			"message": "missing userId",
		})
		return
	}

	authHeader := r.Header.Get("Authorization")
	timezone := r.Header.Get("X-User-Timezone")

	if timezone == "" {
		timezone = "Asia/Saigon"
	}

	result, err := GetBattleActivity(r.Context(), userID, authHeader, timezone)
	if err != nil {
		if activityErr, ok := err.(*BattleActivityError); ok {
			writeJSON(w, activityErr.StatusCode, map[string]interface{}{
				"status":  "error",
				"message": activityErr.Message,
				"data":    activityErr.Data,
			})
			return
		}

		writeJSON(w, http.StatusInternalServerError, map[string]interface{}{
			"status":  "error",
			"message": err.Error(),
		})
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func CheckInStreak(ctx context.Context, idToken string, timezone string) (*CheckInResponse, error) {
	idToken = strings.TrimSpace(idToken)

	if strings.HasPrefix(strings.ToLower(idToken), "bearer ") {
		idToken = strings.TrimSpace(idToken[7:])
	}

	if idToken == "" {
		return nil, &CheckInError{
			StatusCode: http.StatusUnauthorized,
			Message:    "missing Firebase ID token",
		}
	}

	if timezone == "" {
		timezone = "Asia/Saigon"
	}

	payload := CheckInRequest{
		Timezone: timezone,
	}

	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, &CheckInError{
			StatusCode: http.StatusInternalServerError,
			Message:    "error encoding check-in payload",
		}
	}

	apiURL := "https://api.parroto.app/api/streak/checkin"

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	apiReq, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		apiURL,
		bytes.NewReader(bodyBytes),
	)
	if err != nil {
		return nil, &CheckInError{
			StatusCode: http.StatusInternalServerError,
			Message:    "error creating check-in request",
		}
	}

	apiReq.Header.Set("Accept", "application/json, text/plain, */*")
	apiReq.Header.Set("Content-Type", "application/json")
	apiReq.Header.Set("Authorization", "Bearer "+idToken)
	apiReq.Header.Set("Origin", "https://parroto.app")
	apiReq.Header.Set("Referer", "https://parroto.app/")
	apiReq.Header.Set("X-User-Timezone", timezone)
	apiReq.Header.Set("User-Agent", getBrowserUserAgent())

	apiResp, err := client.Do(apiReq)
	if err != nil {
		return nil, &CheckInError{
			StatusCode: http.StatusBadGateway,
			Message:    "cannot connect to check-in API",
		}
	}
	defer apiResp.Body.Close()

	respBody, err := io.ReadAll(apiResp.Body)
	if err != nil {
		return nil, &CheckInError{
			StatusCode: http.StatusInternalServerError,
			Message:    "error reading check-in response",
		}
	}

	if apiResp.StatusCode < 200 || apiResp.StatusCode >= 300 {
		var errData interface{}
		if len(respBody) > 0 {
			_ = json.Unmarshal(respBody, &errData)
		}

		return nil, &CheckInError{
			StatusCode: apiResp.StatusCode,
			Data:       errData,
			Message:    fmt.Sprintf("check-in API returned status %d", apiResp.StatusCode),
		}
	}

	if len(respBody) == 0 {
		return nil, &CheckInError{
			StatusCode: http.StatusInternalServerError,
			Message:    "empty check-in response",
		}
	}

	var result CheckInResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, &CheckInError{
			StatusCode: http.StatusInternalServerError,
			Data:       string(respBody),
			Message:    "error decoding check-in response",
		}
	}

	if result.Status != "success" {
		return nil, &CheckInError{
			StatusCode: apiResp.StatusCode,
			Data:       result,
			Message:    result.Message,
		}
	}

	return &result, nil
}

func GetBattleActivity(ctx context.Context, userID string, idToken string, timezone string) (*BattleActivityResponse, error) {
	userID = strings.TrimSpace(userID)
	idToken = strings.TrimSpace(idToken)

	if userID == "" {
		return nil, &BattleActivityError{
			StatusCode: http.StatusBadRequest,
			Message:    "missing userId",
		}
	}

	if strings.HasPrefix(strings.ToLower(idToken), "bearer ") {
		idToken = strings.TrimSpace(idToken[7:])
	}

	if idToken == "" {
		return nil, &BattleActivityError{
			StatusCode: http.StatusUnauthorized,
			Message:    "missing Firebase ID token",
		}
	}

	if timezone == "" {
		timezone = "Asia/Saigon"
	}

	apiURL := fmt.Sprintf(
		"https://api.parroto.app/api/vocab-battle/activity/%s",
		url.PathEscape(userID),
	)

	client := &http.Client{
		Timeout: 10 * time.Second,
	}

	apiReq, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		apiURL,
		nil,
	)
	if err != nil {
		return nil, &BattleActivityError{
			StatusCode: http.StatusInternalServerError,
			Message:    "error creating battle activity request",
		}
	}

	apiReq.Header.Set("Accept", "application/json, text/plain, */*")
	apiReq.Header.Set("Authorization", "Bearer "+idToken)
	apiReq.Header.Set("Origin", "https://parroto.app")
	apiReq.Header.Set("Referer", "https://parroto.app/")
	apiReq.Header.Set("X-User-Timezone", timezone)
	apiReq.Header.Set("User-Agent", getBrowserUserAgent())

	apiResp, err := client.Do(apiReq)
	if err != nil {
		return nil, &BattleActivityError{
			StatusCode: http.StatusBadGateway,
			Message:    "cannot connect to battle activity API",
		}
	}
	defer apiResp.Body.Close()

	respBody, err := io.ReadAll(apiResp.Body)
	if err != nil {
		return nil, &BattleActivityError{
			StatusCode: http.StatusInternalServerError,
			Message:    "error reading battle activity response",
		}
	}

	if apiResp.StatusCode < 200 || apiResp.StatusCode >= 300 {
		var errData interface{}
		if len(respBody) > 0 {
			_ = json.Unmarshal(respBody, &errData)
		}

		return nil, &BattleActivityError{
			StatusCode: apiResp.StatusCode,
			Data:       errData,
			Message:    fmt.Sprintf("battle activity API returned status %d", apiResp.StatusCode),
		}
	}

	if len(respBody) == 0 {
		return nil, &BattleActivityError{
			StatusCode: http.StatusInternalServerError,
			Message:    "empty battle activity response",
		}
	}

	var result BattleActivityResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return nil, &BattleActivityError{
			StatusCode: http.StatusInternalServerError,
			Data:       string(respBody),
			Message:    "error decoding battle activity response",
		}
	}

	if result.Status != "success" {
		return nil, &BattleActivityError{
			StatusCode: apiResp.StatusCode,
			Data:       result,
			Message:    result.Message,
		}
	}

	return &result, nil
}

func getBrowserUserAgent() string {
	return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36"
}
