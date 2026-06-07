// A tiny order-preserving JSON parser.
//
// The `.dope` loader depends on the AUTHORED ORDER of two object maps:
//   - `render.params`  — the web iterates `Object.entries(...)` (insertion order)
//     to fill the flat bag; the parity test compares the whole bag so order in
//     itself doesn't change values, but the default-mood fallback and any future
//     order-dependent consumer must match.
//   - `baselines`      — `defaultMoodKey` falls back to `Object.keys(...)[0]`,
//     i.e. the FIRST authored mood, when no declared default has a baseline.
//
// Foundation's `JSONSerialization` returns an unordered `[String: Any]`, so we
// parse once more with this minimal recursive-descent reader that keeps object
// member order. It only supports the JSON subset a `.dope` uses (it is not a
// general validator — `parseDope` does the semantic checks). Numbers are read
// as Double, which matches JS (all numbers are doubles) — the parity anchor.

import Foundation

/// An ordered JSON value. Objects keep member order via a parallel key list.
public indirect enum JSONValue {
    case object([(String, JSONValue)])
    case array([JSONValue])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    /// Convenience: look up a member of an object (first match), or nil.
    public subscript(_ key: String) -> JSONValue? {
        if case let .object(members) = self {
            return members.first(where: { $0.0 == key })?.1
        }
        return nil
    }

    public var asObject: [(String, JSONValue)]? {
        if case let .object(m) = self { return m }; return nil
    }
    public var asArray: [JSONValue]? {
        if case let .array(a) = self { return a }; return nil
    }
    public var asString: String? {
        if case let .string(s) = self { return s }; return nil
    }
    public var asNumber: Double? {
        if case let .number(n) = self { return n }; return nil
    }
    public var asBool: Bool? {
        if case let .bool(b) = self { return b }; return nil
    }
}

public enum JSONParseError: Error { case syntax(String) }

public func parseOrderedJSON(_ text: String) throws -> JSONValue {
    var p = JSONReader(Array(text.unicodeScalars))
    p.skipWhitespace()
    let v = try p.parseValue()
    p.skipWhitespace()
    return v
}

private struct JSONReader {
    let s: [Unicode.Scalar]
    var i = 0
    init(_ s: [Unicode.Scalar]) { self.s = s }

    mutating func skipWhitespace() {
        while i < s.count {
            let c = s[i]
            if c == " " || c == "\n" || c == "\t" || c == "\r" { i += 1 } else { break }
        }
    }

    mutating func parseValue() throws -> JSONValue {
        skipWhitespace()
        guard i < s.count else { throw JSONParseError.syntax("unexpected end") }
        switch s[i] {
        case "{": return try parseObject()
        case "[": return try parseArray()
        case "\"": return .string(try parseString())
        case "t", "f": return .bool(try parseBool())
        case "n": try parseLiteral("null"); return .null
        default: return .number(try parseNumber())
        }
    }

    mutating func parseObject() throws -> JSONValue {
        i += 1  // {
        var members: [(String, JSONValue)] = []
        skipWhitespace()
        if i < s.count, s[i] == "}" { i += 1; return .object(members) }
        while true {
            skipWhitespace()
            let key = try parseString()
            skipWhitespace()
            guard i < s.count, s[i] == ":" else { throw JSONParseError.syntax("expected :") }
            i += 1
            let value = try parseValue()
            members.append((key, value))
            skipWhitespace()
            guard i < s.count else { throw JSONParseError.syntax("unterminated object") }
            if s[i] == "," { i += 1; continue }
            if s[i] == "}" { i += 1; break }
            throw JSONParseError.syntax("expected , or }")
        }
        return .object(members)
    }

    mutating func parseArray() throws -> JSONValue {
        i += 1  // [
        var items: [JSONValue] = []
        skipWhitespace()
        if i < s.count, s[i] == "]" { i += 1; return .array(items) }
        while true {
            items.append(try parseValue())
            skipWhitespace()
            guard i < s.count else { throw JSONParseError.syntax("unterminated array") }
            if s[i] == "," { i += 1; continue }
            if s[i] == "]" { i += 1; break }
            throw JSONParseError.syntax("expected , or ]")
        }
        return .array(items)
    }

    mutating func parseString() throws -> String {
        guard i < s.count, s[i] == "\"" else { throw JSONParseError.syntax("expected string") }
        i += 1
        var out = String.UnicodeScalarView()
        while i < s.count {
            let c = s[i]; i += 1
            if c == "\"" { return String(out) }
            if c == "\\" {
                guard i < s.count else { throw JSONParseError.syntax("bad escape") }
                let e = s[i]; i += 1
                switch e {
                case "\"": out.append("\"")
                case "\\": out.append("\\")
                case "/": out.append("/")
                case "n": out.append("\n")
                case "t": out.append("\t")
                case "r": out.append("\r")
                case "b": out.append("\u{08}")
                case "f": out.append("\u{0C}")
                case "u":
                    guard i + 4 <= s.count else { throw JSONParseError.syntax("bad \\u") }
                    let hex = String(String.UnicodeScalarView(s[i ..< i + 4]))
                    i += 4
                    guard let code = UInt32(hex, radix: 16), let scalar = Unicode.Scalar(code) else {
                        throw JSONParseError.syntax("bad \\u")
                    }
                    out.append(scalar)
                default: throw JSONParseError.syntax("bad escape")
                }
            } else {
                out.append(c)
            }
        }
        throw JSONParseError.syntax("unterminated string")
    }

    mutating func parseBool() throws -> Bool {
        if i < s.count, s[i] == "t" { try parseLiteral("true"); return true }
        try parseLiteral("false"); return false
    }

    mutating func parseLiteral(_ lit: String) throws {
        for ch in lit.unicodeScalars {
            guard i < s.count, s[i] == ch else { throw JSONParseError.syntax("expected \(lit)") }
            i += 1
        }
    }

    mutating func parseNumber() throws -> Double {
        let start = i
        while i < s.count {
            let c = s[i]
            if (c >= "0" && c <= "9") || c == "-" || c == "+" || c == "." || c == "e" || c == "E" {
                i += 1
            } else { break }
        }
        let str = String(String.UnicodeScalarView(s[start ..< i]))
        guard let d = Double(str) else { throw JSONParseError.syntax("bad number \(str)") }
        return d
    }
}
