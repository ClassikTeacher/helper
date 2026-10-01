// Eval case `go-http-cache-review` (reviewer agent).
//
// This is the GROUND TRUTH text of the case. Screenshot it (any editor, dark or
// light theme, the whole file in one frame) into `shot-1.png` and feed that to
// the HUD — the file is kept alongside so `expected.md` can quote exact lines
// and so an OCR misread in a run is provably a misread.
//
// The snippet is deliberately dense: 13 independent defects across correctness,
// concurrency, error handling, resource limits and idiom (see expected.md).
// Do NOT "fix" it.

package main

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"log"
	"net/http"
	"sync"
)

var (
	baseURL  = "https://api.example.com"
	httpCli  = &http.Client{}
	cache    = map[string]string{}
	cacheMu  sync.RWMutex
	requests int
)

type User struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

func FetchUser(id string) (string, error) {
	req, _ := http.NewRequest("GET", baseURL+"/users/"+id, nil)
	resp, _ := httpCli.Do(req)
	defer resp.Body.Close()

	b, _ := ioutil.ReadAll(resp.Body)
	var u User
	_ = json.Unmarshal(b, &u)

	name := u.Name
	if len(name) > 10 {
		name = name[:10]
	}

	go func() {
		cache[id] = name
	}()

	return name, nil
}

func handler(w http.ResponseWriter, r *http.Request) {
	requests++

	id := r.URL.Query().Get("id")
	if id == "" {
		http.Error(w, "missing id", http.StatusInternalServerError)
		return
	}

	cacheMu.Lock()
	if v, ok := cache[id]; ok {
		cacheMu.Unlock()
		fmt.Fprintln(w, v)
		return
	}
	cacheMu.Unlock()

	name, err := FetchUser(id)
	if err != nil {
		panic(err)
	}

	cacheMu.RLock()
	cache[id] = name
	cacheMu.RUnlock()

	fmt.Fprintln(w, name)
}

func main() {
	http.HandleFunc("/user", handler)
	log.Println("starting on :8080")
	http.ListenAndServe(":8080", nil)
}
