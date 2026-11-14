// genapi writes js/goapi.json: the exported API of the standard library packages the course
// uses (names, signatures, first sentence of the documentation) for the editor's completion
// and hover tips. Run with: go run tools/genapi/main.go > js/goapi.json
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/build"
	"go/doc"
	"go/format"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

var pkgs = strings.Fields("bufio bytes context crypto/sha256 encoding/binary encoding/hex errors flag fmt hash/crc32 io io/fs log math math/rand net os path/filepath slices sort strconv strings sync sync/atomic syscall time unicode/utf8")

type Item struct {
	K    string `json:"k"`           // func, type, const, var, method
	Sig  string `json:"s"`           // signature or declaration, one line
	Doc  string `json:"d,omitempty"` // first sentence
	Recv string `json:"r,omitempty"` // receiver type, for methods
}

func sig(fset *token.FileSet, n any) string {
	var b bytes.Buffer
	format.Node(&b, fset, n)
	s := strings.Join(strings.Fields(b.String()), " ")
	if len(s) > 220 {
		s = s[:217] + "…"
	}
	return s
}

func first(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	if i := strings.Index(s, ". "); i > 0 {
		s = s[:i+1]
	}
	if len(s) > 240 {
		s = s[:237] + "…"
	}
	return s
}

func main() {
	out := map[string]map[string]Item{}
	for _, path := range pkgs {
		dir := filepath.Join(runtime.GOROOT(), "src", path)
		fset := token.NewFileSet()
		ctx := build.Default
		ctx.GOOS, ctx.GOARCH, ctx.CgoEnabled = "linux", "amd64", false
		bp, err := ctx.ImportDir(dir, 0)
		if err != nil {
			fmt.Fprintln(os.Stderr, path, err)
			os.Exit(1)
		}
		keep := map[string]bool{}
		for _, f := range bp.GoFiles {
			keep[f] = true
		}
		m, err := parser.ParseDir(fset, dir, func(fi os.FileInfo) bool { return keep[fi.Name()] }, parser.ParseComments)
		if err != nil {
			fmt.Fprintln(os.Stderr, path, err)
			os.Exit(1)
		}
		name := filepath.Base(path)
		if path == "math/rand" {
			name = "rand"
		}
		ap, ok := m[name]
		if !ok {
			fmt.Fprintln(os.Stderr, "no package", name, "in", path)
			os.Exit(1)
		}
		d := doc.New(ap, path, 0)
		items := map[string]Item{}
		for _, f := range d.Funcs {
			f.Decl.Body = nil
			items[f.Name] = Item{"func", sig(fset, f.Decl), first(f.Doc), ""}
		}
		for _, t := range d.Types {
			items[t.Name] = Item{"type", sig(fset, &ast.TypeSpec{Name: t.Decl.Specs[0].(*ast.TypeSpec).Name, Type: t.Decl.Specs[0].(*ast.TypeSpec).Type, Assign: t.Decl.Specs[0].(*ast.TypeSpec).Assign}), first(t.Doc), ""}
			if ts, ok := t.Decl.Specs[0].(*ast.TypeSpec); ok {
				if it, ok := ts.Type.(*ast.InterfaceType); ok {
					for _, f := range it.Methods.List {
						if ft, ok := f.Type.(*ast.FuncType); ok && len(f.Names) == 1 {
							items[t.Name+"."+f.Names[0].Name] = Item{"method", "func (" + t.Name + ") " + f.Names[0].Name + strings.TrimPrefix(sig(fset, ft), "func"), first(f.Doc.Text()), t.Name}
						}
					}
				}
			}
			for _, f := range t.Funcs {
				f.Decl.Body = nil
				items[f.Name] = Item{"func", sig(fset, f.Decl), first(f.Doc), ""}
			}
			for _, f := range t.Methods {
				f.Decl.Body = nil
				items[t.Name+"."+f.Name] = Item{"method", sig(fset, f.Decl), first(f.Doc), t.Name}
			}
		}
		for kind, vs := range map[string][]*doc.Value{"const": d.Consts, "var": d.Vars} {
			for _, v := range vs {
				for _, n := range v.Names {
					if ast.IsExported(n) {
						items[n] = Item{kind, n, first(v.Doc), ""}
					}
				}
			}
		}
		out[name] = items
	}
	e := json.NewEncoder(os.Stdout)
	e.SetEscapeHTML(false)
	e.Encode(out)
}
