package main

import (
	"bufio"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type Area struct {
	Code       string `json:"code"`
	Name       string `json:"name"`
	Level      string `json:"level"`
	Province   string `json:"province"`
	City       string `json:"city"`
	ParentCode string `json:"parent_code"`
	Path       string `json:"path"`
	Status     string `json:"status"`
	StartYear  string `json:"start_year"`
	EndYear    string `json:"end_year"`
	NewCode    string `json:"new_code"`
	Source     string `json:"source"`
}

type Change struct {
	ChangeType string `json:"change_type"`
	Year       string `json:"year"`
	Code       string `json:"code"`
	Name       string `json:"name"`
	OldName    string `json:"old_name"`
	NewName    string `json:"new_name"`
	NewCode    string `json:"new_code"`
	Source     string `json:"source"`
}

type SourceArea struct {
	Source     string `json:"source"`
	Revision   string `json:"revision"`
	Code       string `json:"code"`
	Name       string `json:"name"`
	Level      string `json:"level"`
	ParentCode string `json:"parent_code"`
	Path       string `json:"path"`
	File       string `json:"file"`
}

type PlateCode struct {
	PlateCode string `json:"plate_code"`
	Region    string `json:"region"`
	re        *regexp.Regexp
}

type Version struct {
	Source   string `json:"source"`
	Revision string `json:"revision"`
	File     string `json:"file"`
}

type Counts struct {
	Areas          int `json:"areas"`
	ActiveAreas    int `json:"active_areas"`
	Changes        int `json:"changes"`
	HistoryRecords int `json:"history_records"`
	PlateCodes     int `json:"plate_codes"`
	Versions       int `json:"versions"`
}

type Store struct {
	Areas          []Area
	AreasByCode    map[string][]Area
	ChildrenByCode map[string][]Area
	ChangesByCode  map[string][]Change
	HistoryByCode  map[string][]SourceArea
	Plates         []PlateCode
	Versions       []Version
	LatestYear     int
	Counts         Counts
}

type AreaFilters struct {
	Query    string
	Level    string
	Status   string
	Province string
	Year     *int
}

func mustLoadStore(fsys fs.FS) *Store {
	store, err := loadStore(fsys)
	if err != nil {
		log.Fatalf("load gb2260 data: %v", err)
	}
	return store
}

func loadStore(fsys fs.FS) (*Store, error) {
	store := &Store{
		AreasByCode:    make(map[string][]Area),
		ChildrenByCode: make(map[string][]Area),
		ChangesByCode:  make(map[string][]Change),
		HistoryByCode:  make(map[string][]SourceArea),
	}

	if err := readCSVRows(fsys, "data/areas.csv", func(idx map[string]int, row []string) error {
		area := Area{
			Code:       csvValue(idx, row, "code"),
			Name:       csvValue(idx, row, "name"),
			Level:      csvValue(idx, row, "level"),
			Province:   csvValue(idx, row, "province"),
			City:       csvValue(idx, row, "city"),
			ParentCode: csvValue(idx, row, "parent_code"),
			Path:       csvValue(idx, row, "path"),
			Status:     csvValue(idx, row, "status"),
			StartYear:  csvValue(idx, row, "start_year"),
			EndYear:    csvValue(idx, row, "end_year"),
			NewCode:    csvValue(idx, row, "new_code"),
			Source:     csvValue(idx, row, "source"),
		}
		store.Areas = append(store.Areas, area)
		store.AreasByCode[area.Code] = append(store.AreasByCode[area.Code], area)
		store.ChildrenByCode[area.ParentCode] = append(store.ChildrenByCode[area.ParentCode], area)
		if area.Status == "active" {
			store.Counts.ActiveAreas++
		}
		store.Counts.Areas++
		store.LatestYear = maxYear(store.LatestYear, area.StartYear, area.EndYear)
		return nil
	}); err != nil {
		return nil, err
	}

	if err := readCSVRows(fsys, "data/changes.csv", func(idx map[string]int, row []string) error {
		change := Change{
			ChangeType: csvValue(idx, row, "change_type"),
			Year:       csvValue(idx, row, "year"),
			Code:       csvValue(idx, row, "code"),
			Name:       csvValue(idx, row, "name"),
			OldName:    csvValue(idx, row, "old_name"),
			NewName:    csvValue(idx, row, "new_name"),
			NewCode:    csvValue(idx, row, "new_code"),
			Source:     csvValue(idx, row, "source"),
		}
		addChange(store.ChangesByCode, change.Code, change)
		for _, key := range newCodeKeys(change.NewCode) {
			addChange(store.ChangesByCode, key, change)
		}
		store.Counts.Changes++
		store.LatestYear = maxYear(store.LatestYear, change.Year)
		return nil
	}); err != nil {
		return nil, err
	}

	if err := readCSVRows(fsys, "data/source_areas.csv", func(idx map[string]int, row []string) error {
		record := SourceArea{
			Source:     csvValue(idx, row, "source"),
			Revision:   csvValue(idx, row, "revision"),
			Code:       csvValue(idx, row, "code"),
			Name:       csvValue(idx, row, "name"),
			Level:      csvValue(idx, row, "level"),
			ParentCode: csvValue(idx, row, "parent_code"),
			Path:       csvValue(idx, row, "path"),
			File:       csvValue(idx, row, "file"),
		}
		store.HistoryByCode[record.Code] = append(store.HistoryByCode[record.Code], record)
		store.Counts.HistoryRecords++
		store.LatestYear = maxYear(store.LatestYear, record.Revision)
		return nil
	}); err != nil {
		return nil, err
	}

	if err := readCSVRows(fsys, "data/plate_codes.csv", func(idx map[string]int, row []string) error {
		plate := PlateCode{
			PlateCode: csvValue(idx, row, "plate_code"),
			Region:    csvValue(idx, row, "region"),
		}
		re, err := regexp.Compile("(?i)^" + plate.PlateCode + "$")
		if err != nil {
			return fmt.Errorf("compile plate pattern %q: %w", plate.PlateCode, err)
		}
		plate.re = re
		store.Plates = append(store.Plates, plate)
		store.Counts.PlateCodes++
		return nil
	}); err != nil {
		return nil, err
	}

	if err := readCSVRows(fsys, "data/versions.csv", func(idx map[string]int, row []string) error {
		version := Version{
			Source:   csvValue(idx, row, "source"),
			Revision: csvValue(idx, row, "revision"),
			File:     csvValue(idx, row, "file"),
		}
		store.Versions = append(store.Versions, version)
		store.Counts.Versions++
		store.LatestYear = maxYear(store.LatestYear, version.Revision)
		return nil
	}); err != nil {
		return nil, err
	}

	store.sort()
	return store, nil
}

func (s *Store) sort() {
	sort.Slice(s.Areas, func(i, j int) bool {
		return areaCodeLess(s.Areas[i], s.Areas[j])
	})
	for code := range s.AreasByCode {
		items := s.AreasByCode[code]
		sort.Slice(items, func(i, j int) bool {
			return areaLifecycleLess(items[i], items[j])
		})
	}
	for code := range s.ChildrenByCode {
		items := s.ChildrenByCode[code]
		sort.Slice(items, func(i, j int) bool {
			return areaCodeLess(items[i], items[j])
		})
	}
	for code := range s.ChangesByCode {
		items := s.ChangesByCode[code]
		sort.Slice(items, func(i, j int) bool {
			return changeLess(items[i], items[j])
		})
		s.ChangesByCode[code] = dedupeChanges(items)
	}
	for code := range s.HistoryByCode {
		items := s.HistoryByCode[code]
		sort.Slice(items, func(i, j int) bool {
			if items[i].Source != items[j].Source {
				return items[i].Source < items[j].Source
			}
			return items[i].Revision < items[j].Revision
		})
	}
	sort.Slice(s.Plates, func(i, j int) bool {
		return s.Plates[i].PlateCode < s.Plates[j].PlateCode
	})
	sort.Slice(s.Versions, func(i, j int) bool {
		if s.Versions[i].Source != s.Versions[j].Source {
			return s.Versions[i].Source < s.Versions[j].Source
		}
		return s.Versions[i].Revision < s.Versions[j].Revision
	})
}

func (s *Store) Search(filters AreaFilters, limit int) ([]Area, int) {
	query := strings.ToLower(strings.TrimSpace(filters.Query))
	items := make([]Area, 0, min(limit, 64))
	total := 0
	for _, area := range s.Areas {
		if filters.Level != "" && area.Level != filters.Level {
			continue
		}
		if filters.Status != "" && area.Status != filters.Status {
			continue
		}
		if filters.Province != "" && area.Province != filters.Province {
			continue
		}
		if filters.Year != nil && !validInYear(area, *filters.Year) {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(area.Code+" "+area.Name+" "+area.Path), query) {
			continue
		}
		total++
		if len(items) < limit {
			items = append(items, area)
		}
	}
	return items, total
}

func (s *Store) Children(code string, year *int) []Area {
	children := s.ChildrenByCode[code]
	if year == nil {
		return append([]Area(nil), children...)
	}
	items := make([]Area, 0, len(children))
	for _, child := range children {
		if validInYear(child, *year) {
			items = append(items, child)
		}
	}
	return items
}

func (s *Store) Changes(code string) []Change {
	return append([]Change(nil), s.ChangesByCode[code]...)
}

func (s *Store) History(code string, source string, limit int) ([]SourceArea, int) {
	history := s.HistoryByCode[code]
	items := make([]SourceArea, 0, min(limit, len(history)))
	total := 0
	for _, record := range history {
		if source != "" && record.Source != source {
			continue
		}
		total++
		if len(items) < limit {
			items = append(items, record)
		}
	}
	return items, total
}

func (s *Store) PlatesFor(prefix string) []PlateCode {
	prefix = strings.TrimSpace(prefix)
	items := make([]PlateCode, 0, 1)
	for _, plate := range s.Plates {
		if strings.EqualFold(plate.PlateCode, prefix) || plate.re.MatchString(prefix) {
			items = append(items, plate)
		}
	}
	return items
}

func readCSVRows(fsys fs.FS, path string, handle func(map[string]int, []string) error) error {
	file, err := fsys.Open(path)
	if err != nil {
		return fmt.Errorf("open %s: %w", path, err)
	}
	defer file.Close()

	reader := csv.NewReader(bufio.NewReaderSize(file, 1<<20))
	reader.FieldsPerRecord = -1
	header, err := reader.Read()
	if err != nil {
		return fmt.Errorf("read header %s: %w", path, err)
	}
	index := make(map[string]int, len(header))
	for i, name := range header {
		name = strings.TrimPrefix(strings.TrimSpace(name), "\ufeff")
		index[name] = i
	}

	for {
		row, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read %s: %w", path, err)
		}
		if len(row) == 0 {
			continue
		}
		if err := handle(index, row); err != nil {
			return fmt.Errorf("parse %s: %w", path, err)
		}
	}
	return nil
}

func csvValue(index map[string]int, row []string, name string) string {
	i, ok := index[name]
	if !ok || i >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[i])
}

func validInYear(area Area, year int) bool {
	start, ok := atoi(area.StartYear)
	if ok && start > year {
		return false
	}
	end, ok := atoi(area.EndYear)
	return !ok || end > year
}

func addChange(changes map[string][]Change, key string, change Change) {
	key = strings.TrimSpace(key)
	if len(key) == 6 {
		changes[key] = append(changes[key], change)
	}
}

func newCodeKeys(value string) []string {
	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == ';' || r == ',' || r == '，'
	})
	keys := make([]string, 0, len(parts)+1)
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if len(part) >= 6 {
			keys = append(keys, part[:6])
		}
		if len(part) == 6 {
			keys = append(keys, part)
		}
	}
	return keys
}

func dedupeChanges(items []Change) []Change {
	if len(items) < 2 {
		return items
	}
	out := items[:0]
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		key := strings.Join([]string{
			item.ChangeType, item.Year, item.Code, item.Name,
			item.OldName, item.NewName, item.NewCode, item.Source,
		}, "\x00")
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, item)
	}
	return out
}

func areaCodeLess(a, b Area) bool {
	if a.Code != b.Code {
		return a.Code < b.Code
	}
	return areaLifecycleLess(a, b)
}

func areaLifecycleLess(a, b Area) bool {
	if a.Status != b.Status {
		return a.Status == "active"
	}
	ay, _ := atoi(a.StartYear)
	by, _ := atoi(b.StartYear)
	if ay != by {
		return ay < by
	}
	return a.Name < b.Name
}

func changeLess(a, b Change) bool {
	ay, aok := atoi(a.Year)
	by, bok := atoi(b.Year)
	if aok != bok {
		return !aok
	}
	if ay != by {
		return ay < by
	}
	if a.ChangeType != b.ChangeType {
		return a.ChangeType < b.ChangeType
	}
	return a.Code < b.Code
}

func maxYear(current int, values ...string) int {
	for _, value := range values {
		year, ok := atoiYear(value)
		if ok && year > current {
			current = year
		}
	}
	return current
}

func atoiYear(value string) (int, bool) {
	value = strings.TrimSpace(value)
	if len(value) != 4 {
		return 0, false
	}
	return atoi(value)
}

func atoi(value string) (int, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	n, err := strconv.Atoi(value)
	return n, err == nil
}
