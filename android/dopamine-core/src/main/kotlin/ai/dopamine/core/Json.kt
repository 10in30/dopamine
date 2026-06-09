// A tiny order-preserving JSON reader — port of swift's `JSONOrdered.swift`.
//
// The `.dope` loader depends on the AUTHORED ORDER of two object maps:
//   - `render.params`  — iterated in insertion order to fill the flat bag.
//   - `baselines`      — `defaultMoodKey` falls back to the FIRST authored mood.
//
// The platform JSON libraries don't guarantee member order, so we parse with this
// minimal recursive-descent reader that keeps it. Numbers are read as Double,
// matching JS (all numbers are doubles) — the parity anchor. It is not a general
// validator; `parseDope` does the semantic checks.

package ai.dopamine.core

/** An ordered JSON value. Objects keep member order via a list of pairs. */
sealed class JsonValue {
    data class Obj(val members: List<Pair<String, JsonValue>>) : JsonValue()
    data class Arr(val items: List<JsonValue>) : JsonValue()
    data class Str(val value: String) : JsonValue()
    data class Num(val value: Double) : JsonValue()
    data class Bool(val value: Boolean) : JsonValue()
    data object Null : JsonValue()

    /** Look up a member of an object (first match), or null. */
    operator fun get(key: String): JsonValue? =
        (this as? Obj)?.members?.firstOrNull { it.first == key }?.second

    val asObject: List<Pair<String, JsonValue>>? get() = (this as? Obj)?.members
    val asArray: List<JsonValue>? get() = (this as? Arr)?.items
    val asString: String? get() = (this as? Str)?.value
    val asNumber: Double? get() = (this as? Num)?.value
    val asBool: Boolean? get() = (this as? Bool)?.value
}

class JsonParseError(message: String) : Exception(message)

fun parseOrderedJson(text: String): JsonValue {
    val reader = JsonReader(text)
    reader.skipWhitespace()
    val v = reader.parseValue()
    reader.skipWhitespace()
    return v
}

private class JsonReader(text: String) {
    private val s: CharArray = text.toCharArray()
    private var i = 0

    fun skipWhitespace() {
        while (i < s.size) {
            val c = s[i]
            if (c == ' ' || c == '\n' || c == '\t' || c == '\r') i++ else break
        }
    }

    fun parseValue(): JsonValue {
        skipWhitespace()
        if (i >= s.size) throw JsonParseError("unexpected end")
        return when (s[i]) {
            '{' -> parseObject()
            '[' -> parseArray()
            '"' -> JsonValue.Str(parseString())
            't', 'f' -> JsonValue.Bool(parseBool())
            'n' -> { parseLiteral("null"); JsonValue.Null }
            else -> JsonValue.Num(parseNumber())
        }
    }

    private fun parseObject(): JsonValue {
        i++ // {
        val members = ArrayList<Pair<String, JsonValue>>()
        skipWhitespace()
        if (i < s.size && s[i] == '}') { i++; return JsonValue.Obj(members) }
        while (true) {
            skipWhitespace()
            val key = parseString()
            skipWhitespace()
            if (i >= s.size || s[i] != ':') throw JsonParseError("expected :")
            i++
            val value = parseValue()
            members.add(key to value)
            skipWhitespace()
            if (i >= s.size) throw JsonParseError("unterminated object")
            when (s[i]) {
                ',' -> { i++; continue }
                '}' -> { i++; break }
                else -> throw JsonParseError("expected , or }")
            }
        }
        return JsonValue.Obj(members)
    }

    private fun parseArray(): JsonValue {
        i++ // [
        val items = ArrayList<JsonValue>()
        skipWhitespace()
        if (i < s.size && s[i] == ']') { i++; return JsonValue.Arr(items) }
        while (true) {
            items.add(parseValue())
            skipWhitespace()
            if (i >= s.size) throw JsonParseError("unterminated array")
            when (s[i]) {
                ',' -> { i++; continue }
                ']' -> { i++; break }
                else -> throw JsonParseError("expected , or ]")
            }
        }
        return JsonValue.Arr(items)
    }

    private fun parseString(): String {
        if (i >= s.size || s[i] != '"') throw JsonParseError("expected string")
        i++
        val out = StringBuilder()
        while (i < s.size) {
            val c = s[i]; i++
            if (c == '"') return out.toString()
            if (c == '\\') {
                if (i >= s.size) throw JsonParseError("bad escape")
                val e = s[i]; i++
                when (e) {
                    '"' -> out.append('"')
                    '\\' -> out.append('\\')
                    '/' -> out.append('/')
                    'n' -> out.append('\n')
                    't' -> out.append('\t')
                    'r' -> out.append('\r')
                    'b' -> out.append('\b')
                    'f' -> out.append('\u000C')
                    'u' -> {
                        if (i + 4 > s.size) throw JsonParseError("bad \\u")
                        val hex = String(s, i, 4)
                        i += 4
                        val code = hex.toIntOrNull(16) ?: throw JsonParseError("bad \\u")
                        out.append(code.toChar())
                    }
                    else -> throw JsonParseError("bad escape")
                }
            } else {
                out.append(c)
            }
        }
        throw JsonParseError("unterminated string")
    }

    private fun parseBool(): Boolean {
        if (i < s.size && s[i] == 't') { parseLiteral("true"); return true }
        parseLiteral("false"); return false
    }

    private fun parseLiteral(lit: String) {
        for (ch in lit) {
            if (i >= s.size || s[i] != ch) throw JsonParseError("expected $lit")
            i++
        }
    }

    private fun parseNumber(): Double {
        val start = i
        while (i < s.size) {
            val c = s[i]
            if ((c in '0'..'9') || c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E') i++ else break
        }
        val str = String(s, start, i - start)
        return str.toDoubleOrNull() ?: throw JsonParseError("bad number $str")
    }
}
