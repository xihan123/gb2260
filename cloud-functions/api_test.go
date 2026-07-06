package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestStoreQueries(t *testing.T) {
	store, err := loadStore(dataFiles)
	if err != nil {
		t.Fatal(err)
	}

	if store.LatestYear != 2025 {
		t.Fatalf("latest year = %d, want 2025", store.LatestYear)
	}

	areas := store.AreasByCode["110101"]
	if len(areas) == 0 || areas[0].Name != "东城区" {
		t.Fatalf("unexpected 110101 areas: %#v", areas)
	}

	year := 2025
	children := store.Children("110000", &year)
	if !containsArea(children, "110101") {
		t.Fatalf("expected 110101 under 110000 in 2025")
	}

	changes := store.Changes("110101")
	if !containsChange(changes, "110103") {
		t.Fatalf("expected change remapping from 110103 to 110101")
	}

	history, total := store.History("110101", "gb", 3)
	if len(history) != 2 || total != 2 || history[0].Source != "gb" {
		t.Fatalf("unexpected history result len=%d total=%d first=%#v", len(history), total, history)
	}

	plates := store.PlatesFor("京A")
	if len(plates) == 0 || plates[0].Region != "北京市" {
		t.Fatalf("unexpected plate result: %#v", plates)
	}
}

func TestRouterEndpoints(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := newRouter(appStore)

	tests := []struct {
		path string
		want int
	}{
		{"/v1/health", http.StatusOK},
		{"/v1/areas/110101", http.StatusOK},
		{"/v1/year/2025?province=北京市&limit=5", http.StatusOK},
		{"/v1/changes/110103", http.StatusOK},
		{"/v1/history/110101?source=gb&limit=3", http.StatusOK},
		{"/v1/plates/京A", http.StatusOK},
		{"/v1/areas/not-code", http.StatusBadRequest},
	}

	for _, tc := range tests {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, tc.path, nil)
		router.ServeHTTP(w, req)
		if w.Code != tc.want {
			t.Fatalf("%s: got status %d body %s, want %d", tc.path, w.Code, w.Body.String(), tc.want)
		}
	}

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/search?q=北京&status=active&limit=3", nil)
	router.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("search got status %d: %s", w.Code, w.Body.String())
	}
	var body struct {
		Items []Area `json:"items"`
		Total int    `json:"total"`
		Limit int    `json:"limit"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Total == 0 || len(body.Items) == 0 || body.Limit != 3 {
		t.Fatalf("unexpected search body: %#v", body)
	}
}

func containsArea(items []Area, code string) bool {
	for _, item := range items {
		if item.Code == code {
			return true
		}
	}
	return false
}

func containsChange(items []Change, code string) bool {
	for _, item := range items {
		if item.Code == code {
			return true
		}
	}
	return false
}
