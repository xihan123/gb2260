package main

import (
	"embed"
	"net/http"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

//go:embed data/*.csv
var dataFiles embed.FS

var appStore = mustLoadStore(dataFiles)

func main() {
	r := newRouter(appStore)
	_ = r.Run(":9000")
}

func newRouter(store *Store) *gin.Engine {
	r := gin.Default()

	v1 := r.Group("/v1")
	{
		v1.GET("/health", func(c *gin.Context) {
			c.JSON(http.StatusOK, gin.H{
				"status":      "ok",
				"runtime":     "go",
				"version":     runtime.Version(),
				"framework":   "gin",
				"latest_year": store.LatestYear,
				"counts":      store.Counts,
				"timestamp":   time.Now().UTC().Format(time.RFC3339),
			})
		})

		areas := v1.Group("/areas")
		{
			areas.GET("/:code", getAreasByCode(store))
			areas.GET("/:code/children", getAreaChildren(store))
		}

		v1.GET("/search", searchAreas(store))
		v1.GET("/year/:year", getAreasByYear(store))
		v1.GET("/changes/:code", getChanges(store))
		v1.GET("/history/:code", getHistory(store))
		v1.GET("/plates/:prefix", getPlate(store))
		v1.GET("/versions", getVersions(store))
	}

	return r
}

func getAreasByCode(store *Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		code, ok := codeParam(c, "code")
		if !ok {
			return
		}
		items := store.AreasByCode[code]
		respondList(c, items, len(items), len(items))
	}
}

func getAreaChildren(store *Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		code, ok := codeParam(c, "code")
		if !ok {
			return
		}
		year, ok := optionalYear(c, "year")
		if !ok {
			return
		}
		items := store.Children(code, year)
		respondList(c, items, len(items), len(items))
	}
}

func searchAreas(store *Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		limit, ok := limitParam(c, 50, 500)
		if !ok {
			return
		}
		year, ok := optionalYear(c, "year")
		if !ok {
			return
		}

		filters := AreaFilters{
			Query:    strings.TrimSpace(c.Query("q")),
			Level:    strings.TrimSpace(c.Query("level")),
			Status:   strings.TrimSpace(c.Query("status")),
			Province: strings.TrimSpace(c.Query("province")),
			Year:     year,
		}
		if !validOptional(c, "level", filters.Level, "province", "prefecture", "county") {
			return
		}
		if !validOptional(c, "status", filters.Status, "active", "retired") {
			return
		}

		items, total := store.Search(filters, limit)
		respondList(c, items, total, limit)
	}
}

func getAreasByYear(store *Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		year, ok := requiredYear(c, c.Param("year"))
		if !ok {
			return
		}
		limit, ok := limitParam(c, 200, 1000)
		if !ok {
			return
		}
		level := strings.TrimSpace(c.Query("level"))
		if !validOptional(c, "level", level, "province", "prefecture", "county") {
			return
		}
		filters := AreaFilters{
			Level:    level,
			Province: strings.TrimSpace(c.Query("province")),
			Year:     &year,
		}
		items, total := store.Search(filters, limit)
		respondList(c, items, total, limit)
	}
}

func getChanges(store *Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		code, ok := codeParam(c, "code")
		if !ok {
			return
		}
		items := store.Changes(code)
		respondList(c, items, len(items), len(items))
	}
}

func getHistory(store *Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		code, ok := codeParam(c, "code")
		if !ok {
			return
		}
		limit, ok := limitParam(c, 200, 1000)
		if !ok {
			return
		}
		source := strings.TrimSpace(c.Query("source"))
		if !validOptional(c, "source", source, "gb", "stats", "mca", "areacodes") {
			return
		}
		items, total := store.History(code, source, limit)
		respondList(c, items, total, limit)
	}
}

func getPlate(store *Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		prefix := strings.TrimSpace(c.Param("prefix"))
		if prefix == "" || len([]rune(prefix)) > 16 {
			badRequest(c, "invalid plate prefix")
			return
		}
		items := store.PlatesFor(prefix)
		respondList(c, items, len(items), len(items))
	}
}

func getVersions(store *Store) gin.HandlerFunc {
	return func(c *gin.Context) {
		respondList(c, store.Versions, len(store.Versions), len(store.Versions))
	}
}

func respondList(c *gin.Context, items any, total int, limit int) {
	c.JSON(http.StatusOK, gin.H{
		"items": items,
		"total": total,
		"limit": limit,
	})
}

func codeParam(c *gin.Context, name string) (string, bool) {
	code := strings.TrimSpace(c.Param(name))
	if len(code) != 6 {
		badRequest(c, "code must be 6 digits")
		return "", false
	}
	for _, r := range code {
		if r < '0' || r > '9' {
			badRequest(c, "code must be 6 digits")
			return "", false
		}
	}
	return code, true
}

func optionalYear(c *gin.Context, name string) (*int, bool) {
	value := strings.TrimSpace(c.Query(name))
	if value == "" {
		return nil, true
	}
	year, ok := requiredYear(c, value)
	if !ok {
		return nil, false
	}
	return &year, true
}

func requiredYear(c *gin.Context, value string) (int, bool) {
	year, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		badRequest(c, "year must be an integer")
		return 0, false
	}
	return year, true
}

func limitParam(c *gin.Context, fallback int, max int) (int, bool) {
	value := strings.TrimSpace(c.Query("limit"))
	if value == "" {
		return fallback, true
	}
	limit, err := strconv.Atoi(value)
	if err != nil || limit < 1 {
		badRequest(c, "limit must be a positive integer")
		return 0, false
	}
	if limit > max {
		limit = max
	}
	return limit, true
}

func validOptional(c *gin.Context, name string, value string, allowed ...string) bool {
	if value == "" {
		return true
	}
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	badRequest(c, "invalid "+name)
	return false
}

func badRequest(c *gin.Context, message string) {
	c.JSON(http.StatusBadRequest, gin.H{"error": message})
}
