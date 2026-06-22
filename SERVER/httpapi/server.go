package httpapi

import (
	"net/http"

	"SERVER/botqueue"
	"SERVER/serverlog"
	"SERVER/storage"
)

type Server struct {
	store    *storage.Store
	botQueue *botqueue.Manager
}

func New(store *storage.Store, botQueue *botqueue.Manager) *Server {
	return &Server{
		store:    store,
		botQueue: botQueue,
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/cards", serverlog.WithLogging(s.cards))
	mux.HandleFunc("/guess-word", serverlog.WithLogging(s.guessWord))
	mux.HandleFunc("/check-in", serverlog.WithLogging(s.checkIn))
	mux.HandleFunc("/battle-activity", serverlog.WithLogging(s.battleActivity))
	mux.HandleFunc("/refresh-token", serverlog.WithLogging(s.refreshToken))
	mux.HandleFunc("/bot-queue/start", serverlog.WithLogging(s.botQueueStart))
	mux.HandleFunc("/bot-queue/status", serverlog.WithLogging(s.botQueueStatus))
	mux.HandleFunc("/bot-queue/stop", serverlog.WithLogging(s.botQueueStop))
	mux.HandleFunc("/bot-queue/event", serverlog.WithLogging(s.botQueueEvent))

	return mux
}

func enableCORS(w http.ResponseWriter) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
	w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, X-User-Timezone")
}
