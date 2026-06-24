package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"SERVER/response"
	"SERVER/serverlog"
)

var collectionJSONMu sync.Mutex

type collectionCardRequest struct {
	Card map[string]any `json:"card"`
}

type collectionDataFile struct {
	Data []collectionDataItem `json:"data"`
}

type collectionDataItem struct {
	Card map[string]any `json:"card"`
}

func collectionDataJSONPath() string {
	if value := strings.TrimSpace(os.Getenv("COLLECTION_DATA_PATH")); value != "" {
		return value
	}

	candidates := []string{
		filepath.Join("COLLECTION", "data.json"),
		filepath.Join("..", "COLLECTION", "data.json"),
	}

	for _, candidate := range candidates {
		if info, err := os.Stat(filepath.Dir(candidate)); err == nil && info.IsDir() {
			return candidate
		}
	}

	return filepath.Join("COLLECTION", "data.json")
}

func getStringField(m map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := m[key]; ok {
			text := strings.TrimSpace(toString(value))
			if text != "" {
				return text
			}
		}
	}
	return ""
}

func toString(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case []byte:
		return string(v)
	default:
		b, _ := json.Marshal(v)
		return strings.Trim(string(b), "\"")
	}
}

func readCollectionData(path string) (collectionDataFile, error) {
	var file collectionDataFile

	content, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return collectionDataFile{Data: []collectionDataItem{}}, nil
		}
		return file, err
	}

	if len(strings.TrimSpace(string(content))) == 0 {
		return collectionDataFile{Data: []collectionDataItem{}}, nil
	}

	if err := json.Unmarshal(content, &file); err != nil {
		return file, err
	}

	if file.Data == nil {
		file.Data = []collectionDataItem{}
	}

	return file, nil
}

func writeCollectionData(path string, file collectionDataFile) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}

	content, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, append(content, '\n'), 0644)
}

func (s *Server) collectionCards(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodPost {
		response.WriteJSON(w, http.StatusMethodNotAllowed, response.API{
			Success: false,
			Message: "Method is not supported",
		})
		return
	}

	var req collectionCardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		serverlog.Warn("POST /collection/cards - invalid JSON")
		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: "Invalid JSON",
		})
		return
	}

	if req.Card == nil {
		serverlog.Warn("POST /collection/cards - missing card")
		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: "card cannot be empty",
		})
		return
	}

	cardID := getStringField(req.Card, "cardId", "card_id")
	if cardID == "" {
		serverlog.Warn("POST /collection/cards - missing cardId")
		response.WriteJSON(w, http.StatusBadRequest, response.API{
			Success: false,
			Message: "card.cardId cannot be empty",
		})
		return
	}

	dataObj, _ := req.Card["data"].(map[string]any)
	if dataObj == nil {
		dataObj = map[string]any{}
	}
	dataObj["collectedAtServer"] = time.Now().Format(time.RFC3339)
	req.Card["data"] = dataObj

	path := collectionDataJSONPath()

	collectionJSONMu.Lock()
	defer collectionJSONMu.Unlock()

	file, err := readCollectionData(path)
	if err != nil {
		serverlog.Error(fmt.Sprintf("POST /collection/cards - read error: %v", err))
		response.WriteJSON(w, http.StatusInternalServerError, response.API{
			Success: false,
			Message: fmt.Sprintf("Cannot read COLLECTION/data.json: %v", err),
		})
		return
	}

	updated := false
	for i := range file.Data {
		currentID := getStringField(file.Data[i].Card, "cardId", "card_id")
		if currentID == cardID {
			file.Data[i].Card = req.Card
			updated = true
			break
		}
	}

	if !updated {
		file.Data = append(file.Data, collectionDataItem{Card: req.Card})
	}

	if err := writeCollectionData(path, file); err != nil {
		serverlog.Error(fmt.Sprintf("POST /collection/cards - write error: %v", err))
		response.WriteJSON(w, http.StatusInternalServerError, response.API{
			Success: false,
			Message: fmt.Sprintf("Cannot write COLLECTION/data.json: %v", err),
		})
		return
	}

	serverlog.Success(fmt.Sprintf("POST /collection/cards - saved card_id=%s | updated=%v | total=%d", cardID, updated, len(file.Data)))
	response.WriteJSON(w, http.StatusOK, response.API{
		Success: true,
		Message: "Saved card to COLLECTION/data.json",
		Data: map[string]any{
			"path":    path,
			"updated": updated,
			"total":   len(file.Data),
			"cardId":  cardID,
		},
	})
}

func (s *Server) collectionDataJSON(w http.ResponseWriter, r *http.Request) {
	enableCORS(w)
	w.Header().Set("Content-Type", "application/json; charset=utf-8")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != http.MethodGet {
		response.WriteJSON(w, http.StatusMethodNotAllowed, response.API{
			Success: false,
			Message: "Method is not supported",
		})
		return
	}

	path := collectionDataJSONPath()

	collectionJSONMu.Lock()
	defer collectionJSONMu.Unlock()

	file, err := readCollectionData(path)
	if err != nil {
		serverlog.Error(fmt.Sprintf("GET /collection/data.json - read error: %v", err))
		response.WriteJSON(w, http.StatusInternalServerError, response.API{
			Success: false,
			Message: fmt.Sprintf("Cannot read COLLECTION/data.json: %v", err),
		})
		return
	}

	serverlog.Info(fmt.Sprintf("GET /collection/data.json - returned %d items", len(file.Data)))
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(file)
}
