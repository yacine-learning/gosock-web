// genapi writes the standard library documentation the editor uses:
//
//	js/goapi.json        every exported name of the packages below: kind, short signature, first
//	                     sentence of its documentation. Loaded with the page (completion, type
//	                     inference, hover).
//	js/godoc/<pkg>.json  per package, loaded when a name of that package is first needed: the
//	                     signature as gopls shows it (qualified names, one type per parameter),
//	                     the whole documentation as HTML, and the parameters for signature help.
//
// Run from the repository root: go run tools/genapi/main.go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"go/ast"
	"go/build"
	"go/doc"
	"go/doc/comment"
	"go/format"
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

var pkgs = strings.Fields("bufio bytes context crypto/sha256 encoding/binary encoding/hex errors flag fmt hash/crc32 io io/fs log math math/rand net os path/filepath slices sort strconv strings sync sync/atomic syscall time unicode/utf8")

// the name a program uses for each package: the last element of its path
var short = map[string]string{}

type Item struct {
	K    string `json:"k"`           // func, type, const, var, method
	Sig  string `json:"s"`           // signature or declaration, one line
	Doc  string `json:"d,omitempty"` // first sentence
	Recv string `json:"r,omitempty"` // receiver type, for methods
}

type Doc struct {
	Sig    string   `json:"s"`           // as gopls shows it; several lines for a type
	HTML   string   `json:"h,omitempty"` // the whole documentation
	Params []string `json:"a,omitempty"` // "network string", one per parameter (signature help)
	Res    string   `json:"res,omitempty"`
	Var    bool     `json:"v,omitempty"` // the last parameter is variadic
}

var fset = token.NewFileSet()

func node(n any) string {
	var b bytes.Buffer
	format.Node(&b, fset, n)
	return b.String()
}

func oneLine(n any) string {
	s := strings.Join(strings.Fields(node(n)), " ")
	if len(s) > 220 {
		s = s[:217] + "…"
	}
	return s
}

var docLink = regexp.MustCompile(`\[(\*?[\w.]+)\]`)

func first(s string) string {
	s = docLink.ReplaceAllString(strings.Join(strings.Fields(s), " "), "$1")
	if i := strings.Index(s, ". "); i > 0 {
		s = s[:i+1]
	}
	if len(s) > 240 {
		s = s[:237] + "…"
	}
	return s
}

// qualify returns a copy of the type expression e in which the package's own exported types
// carry the package name, as gopls writes them: Listener -> net.Listener.
func qualify(e ast.Expr, pkg string, own map[string]bool) ast.Expr {
	q := func(x ast.Expr) ast.Expr { return qualify(x, pkg, own) }
	switch x := e.(type) {
	case *ast.Ident:
		if own[x.Name] {
			return &ast.SelectorExpr{X: ast.NewIdent(pkg), Sel: ast.NewIdent(x.Name)}
		}
		return x
	case *ast.StarExpr:
		return &ast.StarExpr{X: q(x.X)}
	case *ast.ArrayType:
		return &ast.ArrayType{Len: x.Len, Elt: q(x.Elt)}
	case *ast.Ellipsis:
		return &ast.Ellipsis{Elt: q(x.Elt)}
	case *ast.MapType:
		return &ast.MapType{Key: q(x.Key), Value: q(x.Value)}
	case *ast.ChanType:
		return &ast.ChanType{Dir: x.Dir, Value: q(x.Value)}
	case *ast.FuncType:
		return &ast.FuncType{TypeParams: x.TypeParams, Params: fields(x.Params, pkg, own, false), Results: fields(x.Results, pkg, own, false)}
	case *ast.IndexExpr:
		return &ast.IndexExpr{X: q(x.X), Index: q(x.Index)}
	case *ast.IndexListExpr:
		l := make([]ast.Expr, len(x.Indices))
		for i, y := range x.Indices {
			l[i] = q(y)
		}
		return &ast.IndexListExpr{X: q(x.X), Indices: l}
	case *ast.ParenExpr:
		return &ast.ParenExpr{X: q(x.X)}
	}
	return e
}

// fields copies a parameter or result list with qualified types; expand gives each name its
// own entry ("network, address string" -> "network string, address string").
func fields(fl *ast.FieldList, pkg string, own map[string]bool, expand bool) *ast.FieldList {
	if fl == nil {
		return nil
	}
	out := &ast.FieldList{}
	for _, f := range fl.List {
		t := qualify(f.Type, pkg, own)
		if expand && len(f.Names) > 1 {
			for _, n := range f.Names {
				out.List = append(out.List, &ast.Field{Names: []*ast.Ident{ast.NewIdent(n.Name)}, Type: t})
			}
			continue
		}
		out.List = append(out.List, &ast.Field{Names: f.Names, Type: t})
	}
	return out
}

// funcDoc describes a function or method: recv is the receiver field (nil for a function;
// a nameless one for an interface method).
func funcDoc(name string, recv *ast.FieldList, ft *ast.FuncType, pkg string, own map[string]bool) Doc {
	params, results := fields(ft.Params, pkg, own, true), fields(ft.Results, pkg, own, true)
	nameIdent := ast.NewIdent(pkg + "." + name)
	if pkg == "builtin" {
		nameIdent = ast.NewIdent(name)
	}
	if recv != nil {
		nameIdent = ast.NewIdent(name)
		recv = fields(recv, pkg, own, false)
	}
	decl := &ast.FuncDecl{Recv: recv, Name: nameIdent, Type: &ast.FuncType{TypeParams: ft.TypeParams, Params: params, Results: results}}
	d := Doc{Sig: strings.Join(strings.Fields(node(decl)), " ")}
	for i, f := range params.List {
		s := node(f.Type)
		if len(f.Names) > 0 {
			s = f.Names[0].Name + " " + s
		}
		d.Params = append(d.Params, s)
		if _, ok := f.Type.(*ast.Ellipsis); ok && i == len(params.List)-1 {
			d.Var = true
		}
	}
	if results != nil && len(results.List) > 0 {
		var rs []string
		for _, f := range results.List {
			s := node(f.Type)
			if len(f.Names) > 0 {
				s = f.Names[0].Name + " " + s
			}
			rs = append(rs, s)
		}
		d.Res = strings.Join(rs, ", ")
		if len(rs) > 1 || len(results.List[0].Names) > 0 {
			d.Res = "(" + d.Res + ")"
		}
	}
	return d
}

func main() {
	api := map[string]map[string]Item{}
	docs := map[string]map[string]Doc{}
	imp := importer.ForCompiler(fset, "source", nil)
	for _, path := range append(pkgs, "builtin") {
		short[path] = filepath.Base(path)
	}
	for _, path := range append(pkgs, "builtin") { // builtin: documentation only (len, append, error…)
		dir := filepath.Join(runtime.GOROOT(), "src", path)
		ctx := build.Default
		ctx.GOOS, ctx.GOARCH, ctx.CgoEnabled = "linux", "amd64", false
		bp, err := ctx.ImportDir(dir, 0)
		check(path, err)
		keep := map[string]bool{}
		for _, f := range bp.GoFiles {
			keep[f] = true
		}
		m, err := parser.ParseDir(fset, dir, func(fi os.FileInfo) bool { return keep[fi.Name()] }, parser.ParseComments)
		check(path, err)
		name := short[path]
		ap, ok := m[name]
		if !ok {
			check(path, fmt.Errorf("no package %s", name))
		}
		var tp *types.Package // for the values of constants
		if path != "builtin" {
			tp, err = imp.Import(path)
			check(path, err)
		}
		mode := doc.Mode(0)
		if path == "builtin" { // its names are lower case
			mode = doc.AllDecls
		}
		d := doc.New(ap, path, mode)
		own := map[string]bool{}
		for _, t := range d.Types {
			own[t.Name] = path != "builtin"
		}

		// documentation comments as HTML; [Name] links become #go:pkg.Name, opened in the tooltip
		cp, pr := d.Parser(), d.Printer()
		pr.HeadingLevel = 4
		pr.DocLinkURL = func(l *comment.DocLink) string {
			p := l.ImportPath
			if p == "" {
				p = path
			}
			s, ok := short[p]
			if !ok {
				return "https://pkg.go.dev/" + p + "#" + strings.TrimPrefix(l.Recv+"."+l.Name, ".")
			}
			if l.Name == "" {
				return "#go:" + s
			}
			if l.Recv != "" {
				return "#go:" + s + "." + l.Recv + "." + l.Name
			}
			return "#go:" + s + "." + l.Name
		}
		html := func(text string) string {
			if strings.TrimSpace(text) == "" {
				return ""
			}
			return strings.TrimSpace(string(pr.HTML(cp.Parse(text))))
		}

		items, dd := map[string]Item{}, map[string]Doc{}
		addFunc := func(key string, f *doc.Func, recvType string) {
			f.Decl.Body = nil
			it := Item{"func", oneLine(f.Decl), first(f.Doc), ""}
			if recvType != "" {
				it.K, it.Recv = "method", recvType
			}
			items[key] = it
			x := funcDoc(f.Name, f.Decl.Recv, f.Decl.Type, name, own)
			x.HTML = html(f.Doc)
			dd[key] = x
		}
		for _, f := range d.Funcs {
			addFunc(f.Name, f, "")
		}
		for _, t := range d.Types {
			ts := t.Decl.Specs[0].(*ast.TypeSpec)
			items[t.Name] = Item{"type", oneLine(&ast.TypeSpec{Name: ts.Name, Type: ts.Type, Assign: ts.Assign}), first(t.Doc), ""}
			// the declaration as in the source, then its methods, like gopls
			sig := node(&ast.GenDecl{Tok: token.TYPE, Specs: []ast.Spec{ts}})
			if lines := strings.Split(sig, "\n"); len(lines) > 30 {
				sig = strings.Join(lines[:28], "\n") + "\n\t// …\n}"
			}
			var ms []string
			for _, f := range t.Methods {
				f.Decl.Body = nil
				ms = append(ms, oneLine(&ast.FuncDecl{Recv: f.Decl.Recv, Name: f.Decl.Name, Type: f.Decl.Type}))
			}
			if len(ms) > 0 {
				if len(ms) > 24 {
					ms = append(ms[:23], fmt.Sprintf("// … and %d more methods", len(ms)-23))
				}
				sig += "\n\n" + strings.Join(ms, "\n")
			}
			dd[t.Name] = Doc{Sig: sig, HTML: html(t.Doc)}
			if it, ok := ts.Type.(*ast.InterfaceType); ok {
				for _, f := range it.Methods.List {
					if ft, ok := f.Type.(*ast.FuncType); ok && len(f.Names) == 1 {
						key := t.Name + "." + f.Names[0].Name
						items[key] = Item{"method", "func (" + t.Name + ") " + f.Names[0].Name + strings.TrimPrefix(oneLine(ft), "func"), first(f.Doc.Text()), t.Name}
						x := funcDoc(f.Names[0].Name, &ast.FieldList{List: []*ast.Field{{Type: ast.NewIdent(t.Name)}}}, ft, name, own)
						x.HTML = html(f.Doc.Text())
						dd[key] = x
					}
				}
			}
			for _, f := range t.Funcs {
				addFunc(f.Name, f, "")
			}
			for _, f := range t.Methods {
				addFunc(t.Name+"."+f.Name, f, t.Name)
			}
			for _, vs := range [][]*doc.Value{t.Consts, t.Vars} {
				addValues(vs, name, tp, items, dd, html)
			}
		}
		addValues(d.Consts, name, tp, items, dd, html)
		addValues(d.Vars, name, tp, items, dd, html)
		dd[""] = Doc{Sig: "package " + name + " (\"" + path + "\")", HTML: html(d.Doc)}
		if path == "builtin" {
			dd[""] = Doc{Sig: "builtin", HTML: html(d.Doc)}
		} else {
			api[name] = items
		}
		docs[name] = dd
	}
	write("js/goapi.json", api)
	os.MkdirAll("js/godoc", 0o755)
	for n, dd := range docs {
		write("js/godoc/"+n+".json", dd)
	}
}

// constants and variables: "const net.IPv4len untyped int = 4", "var os.Args []string"
func addValues(vs []*doc.Value, pkg string, tp *types.Package, items map[string]Item, dd map[string]Doc, html func(string) string) {
	for _, v := range vs {
		h := html(v.Doc)
		for _, n := range v.Names {
			if !ast.IsExported(n) && tp != nil {
				continue
			}
			var obj types.Object
			kind, sig := "var", "var "+pkg+"."+n
			if tp != nil {
				obj = tp.Scope().Lookup(n)
			} else { // builtin: true, false, iota, nil
				kind, sig = "const", strings.TrimSpace(strings.Split(oneLine(v.Decl), "//")[0])
				if strings.HasPrefix(sig, "var") {
					kind = "var"
				}
				sig = strings.ReplaceAll(sig, "( ", "")
				sig = strings.TrimSuffix(strings.ReplaceAll(sig, " )", ""), ")")
				sig = strings.Replace(strings.Replace(sig, "const(", "const ", 1), "var(", "var ", 1)
			}
			qual := func(p *types.Package) string { return p.Name() }
			switch o := obj.(type) {
			case *types.Const:
				kind, sig = "const", "const "+pkg+"."+n+" "+types.TypeString(o.Type(), qual)+" = "+o.Val().ExactString()
			case *types.Var:
				sig += " " + types.TypeString(o.Type(), qual)
			}
			items[n] = Item{kind, n, first(v.Doc), ""}
			dd[n] = Doc{Sig: sig, HTML: h}
		}
	}
}

func write(file string, v any) {
	var b bytes.Buffer
	e := json.NewEncoder(&b)
	e.SetEscapeHTML(false)
	check(file, e.Encode(v))
	check(file, os.WriteFile(file, b.Bytes(), 0o644))
}

func check(what string, err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, what+":", err)
		os.Exit(1)
	}
}
