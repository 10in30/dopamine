// Low-level OpenGL ES 3.0 helpers — the Android analog of `engine/context.ts` +
// `engine/gl.ts`. A `GlContext` owns the per-surface GL state on the GL thread:
// a program cache (so the expensive link happens once per shader, not per fire,
// mirroring the web GLContext), the empty VAO the full-screen-triangle draw binds,
// and the live drawable size. Everything here runs on the GLSurfaceView GL thread.

package ai.dopamine.gl

import android.graphics.Bitmap
import android.opengl.GLES30
import android.opengl.GLUtils
import java.nio.ByteBuffer

/** A linked GL program + a memoized uniform-location lookup (-1 == not declared). */
class GlProgram(val id: Int) {
    private val locations = HashMap<String, Int>()

    /** Cached `glGetUniformLocation`. Returns -1 if the shader doesn't declare it. */
    fun uniform(name: String): Int =
        locations.getOrPut(name) { GLES30.glGetUniformLocation(id, name) }

    /** Pre-resolve a batch of uniform locations (matches web `prog.uniforms(...)`). */
    fun resolve(names: Iterable<String>) { for (n in names) uniform(n) }
}

/**
 * Per-surface GL state. Created on `onSurfaceCreated`; resized on
 * `onSurfaceChanged`. Holds the program cache + the empty VAO + the drawable size
 * the runners read (the analog of `glc.canvas.width/height`).
 */
class GlContext {
    var width: Int = 1
        private set
    var height: Int = 1
        private set

    private val programs = HashMap<String, GlProgram>()
    var vao: Int = 0
        private set

    /** (Re)initialize the GL-thread state. Programs do NOT survive a context loss. */
    fun onSurfaceCreated() {
        programs.clear()
        val ids = IntArray(1)
        GLES30.glGenVertexArrays(1, ids, 0)
        vao = ids[0]
    }

    fun onSurfaceChanged(w: Int, h: Int) {
        width = w
        height = h
    }

    /** Compile + link (cached by source) and return the program. */
    fun program(vertex: String, fragment: String): GlProgram =
        programs.getOrPut(vertex + " " + fragment) { GlProgram(linkProgram(vertex, fragment)) }
}

/** Compile one shader stage; throws with the driver log on failure. */
fun compileShader(type: Int, src: String): Int {
    val shader = GLES30.glCreateShader(type)
    GLES30.glShaderSource(shader, src)
    GLES30.glCompileShader(shader)
    val status = IntArray(1)
    GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, status, 0)
    if (status[0] == 0) {
        val log = GLES30.glGetShaderInfoLog(shader)
        GLES30.glDeleteShader(shader)
        val kind = if (type == GLES30.GL_VERTEX_SHADER) "vertex" else "fragment"
        throw RuntimeException("dopamine: $kind shader compile failed:\n$log")
    }
    return shader
}

/** Compile vertex + fragment, link, and return the program; throws on failure. */
fun linkProgram(vertex: String, fragment: String): Int {
    val vs = compileShader(GLES30.GL_VERTEX_SHADER, vertex)
    val fs = compileShader(GLES30.GL_FRAGMENT_SHADER, fragment)
    val prog = GLES30.glCreateProgram()
    GLES30.glAttachShader(prog, vs)
    GLES30.glAttachShader(prog, fs)
    GLES30.glLinkProgram(prog)
    // The stages are reference-counted by the program; detach+delete so they free
    // when the program does.
    GLES30.glDetachShader(prog, vs)
    GLES30.glDetachShader(prog, fs)
    GLES30.glDeleteShader(vs)
    GLES30.glDeleteShader(fs)
    val status = IntArray(1)
    GLES30.glGetProgramiv(prog, GLES30.GL_LINK_STATUS, status, 0)
    if (status[0] == 0) {
        val log = GLES30.glGetProgramInfoLog(prog)
        GLES30.glDeleteProgram(prog)
        throw RuntimeException("dopamine: program link failed:\n$log")
    }
    return prog
}

/** Allocate a linear / edge-clamped RGBA texture (pixels uploaded later). */
fun allocTexture(): Int {
    val ids = IntArray(1)
    GLES30.glGenTextures(1, ids, 0)
    GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, ids[0])
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
    return ids[0]
}

/**
 * Upload an ARGB_8888 Bitmap as an RGBA texture. The bitmap is expected to be
 * already vertically flipped by the caller (the panel runner pre-flips its Canvas)
 * so the GL texel orientation matches the web's `UNPACK_FLIP_Y_WEBGL` upload — see
 * `GlPanelRunner`.
 */
fun uploadBitmap(texId: Int, bitmap: Bitmap) {
    GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, texId)
    GLUtils.texImage2D(GLES30.GL_TEXTURE_2D, 0, bitmap, 0)
}

/** Upload a single-channel R8 distance field (an icon SDF), edge-clamped. */
fun uploadR8(texId: Int, size: Int, bytes: ByteArray) {
    GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, texId)
    GLES30.glPixelStorei(GLES30.GL_UNPACK_ALIGNMENT, 1)
    GLES30.glTexImage2D(
        GLES30.GL_TEXTURE_2D, 0, GLES30.GL_R8, size, size, 0,
        GLES30.GL_RED, GLES30.GL_UNSIGNED_BYTE, ByteBuffer.wrap(bytes),
    )
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_LINEAR)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_LINEAR)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
}

/** Draw the single full-screen triangle (no vertex buffers — uses gl_VertexID). */
fun drawFullscreenTriangle(ctx: GlContext) {
    GLES30.glBindVertexArray(ctx.vao)
    GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, 3)
}
