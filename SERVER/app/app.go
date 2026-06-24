package app

import (
	"context"
	"log"
	"net/http"

	"SERVER/botqueue"
	"SERVER/httpapi"
	"SERVER/serverlog"
	"SERVER/storage"
)

const listenAddr = ":8080"

func Run() {
	serverlog.Banner()

	store, err := storage.Open(storage.DefaultDBPath)
	if err != nil {
		log.Fatalf("open database: %v", err)
	}
	defer store.Close()

	if err := store.Init(context.Background()); err != nil {
		log.Fatalf("init database: %v", err)
	}

	serverlog.Success("Database ready: " + storage.DefaultDBPath)

	api := httpapi.New(store, botqueue.NewManager())

	serverlog.Info("API server running at: http://localhost:8080")
	serverlog.Route("POST", "/cards", "Create a new word")
	serverlog.Route("GET", "/cards", "List words")
	serverlog.Route("POST", "/check-in", "Check in to Parroto streak")
	serverlog.Route("POST", "/refresh-token", "Proxy Firebase refresh token API")
	serverlog.Route("POST", "/mailtm", "Generate Mail.tm email address")
	serverlog.Route("GET", "/mailtm/messages", "List messages for a Mail.tm email address")
	serverlog.Route("POST", "/parroto/register", "Register a new Parroto user")
	serverlog.Route("POST", "/guess-word", "Guess a word using LLM")
	serverlog.Route("POST", "/bot-queue/start", "Start bot queue")
	serverlog.Route("GET", "/bot-queue/status", "Get bot queue status")
	serverlog.Route("POST", "/bot-queue/stop", "Stop bot queue")
	serverlog.Route("POST", "/bot-queue/event", "Receive bot/socket event")

	log.Fatal(http.ListenAndServe(listenAddr, api.Routes()))
}
