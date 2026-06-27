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

    // --- Host-side drop-shadow composite ---------------------------------------
    // The web draws the drop-shadow on a separate `multiply` canvas; a GLSurfaceView
    // (like a CAMetalLayer) can't multiply against the backdrop. So — mirroring
    // MetalOverlayHost — we render the shadow pass into an off-screen FBO, then a
    // conversion pass writes premultiplied black (0,0,0, 1-luma) onto the surface
    // with source-over blend, BEHIND the glow: one self-contained surface that
    // darkens the live backdrop. Lazily sized to the drawable; freed on resize/loss.
    private var shadowFbo = 0
    private var shadowTex = 0
    private var shadowSize = 0L   // (width << 32) | height, to detect a resize

    /** (Re)initialize the GL-thread state. Programs do NOT survive a context loss. */
    fun onSurfaceCreated() {
        programs.clear()
        // The FBO/texture names belonged to the lost context; drop them so the next
        // composite re-creates against the fresh context.
        shadowFbo = 0; shadowTex = 0; shadowSize = 0L
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

    private fun ensureShadowTarget() {
        val key = (width.toLong() shl 32) or height.toLong()
        if (shadowFbo != 0 && shadowSize == key) return
        if (shadowFbo != 0) {
            GLES30.glDeleteFramebuffers(1, intArrayOf(shadowFbo), 0)
            GLES30.glDeleteTextures(1, intArrayOf(shadowTex), 0)
        }
        shadowTex = allocTexture()
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, shadowTex)
        GLES30.glTexImage2D(
            GLES30.GL_TEXTURE_2D, 0, GLES30.GL_RGBA8, width, height, 0,
            GLES30.GL_RGBA, GLES30.GL_UNSIGNED_BYTE, null,
        )
        val fb = IntArray(1)
        GLES30.glGenFramebuffers(1, fb, 0)
        shadowFbo = fb[0]
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, shadowFbo)
        GLES30.glFramebufferTexture2D(
            GLES30.GL_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0, GLES30.GL_TEXTURE_2D, shadowTex, 0,
        )
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0)
        shadowSize = key
    }

    /**
     * Render an effect's SHADOW pass into an off-screen target and composite it as a
     * premultiplied-black drop-shadow onto the current surface, BEHIND the glow.
     * `drawShadow` must draw the shadow pass (`uShadow = 1`) as a full-screen pass.
     * Leaves the surface blend as premultiplied source-over — the caller re-arms the
     * additive light blend for its glow pass. Mirrors MetalOverlayHost.tick.
     */
    fun withShadowComposite(drawShadow: () -> Unit) {
        ensureShadowTarget()
        // 1. Shadow pass → off-screen FBO, cleared WHITE (1 = no shadow), blend OFF so
        //    the shader's `mul` output is copied verbatim.
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, shadowFbo)
        GLES30.glViewport(0, 0, width, height)
        GLES30.glDisable(GLES30.GL_BLEND)
        GLES30.glClearColor(1f, 1f, 1f, 1f)
        GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT)
        drawShadow()
        // 2. Conversion → surface: premultiplied black (0,0,0, 1-luma(mul)), source-over.
        GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0)
        GLES30.glViewport(0, 0, width, height)
        GLES30.glEnable(GLES30.GL_BLEND)
        GLES30.glBlendEquation(GLES30.GL_FUNC_ADD)
        GLES30.glBlendFunc(GLES30.GL_ONE, GLES30.GL_ONE_MINUS_SRC_ALPHA)
        val prog = program(SHADOW_CONVERT_VERT, SHADOW_CONVERT_FRAG)
        GLES30.glUseProgram(prog.id)
        GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
        GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, shadowTex)
        prog.uniform("uShadowRaw").let { if (it >= 0) GLES30.glUniform1i(it, 0) }
        drawFullscreenTriangle(this)
    }
}

/** Full-screen-triangle vertex for the host shadow-conversion pass (gl_VertexID). */
private const val SHADOW_CONVERT_VERT = """#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
"""

/** Multiply-colour (1 = no shadow) → premultiplied black with alpha = 1 - luma. */
private const val SHADOW_CONVERT_FRAG = """#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uShadowRaw;
out vec4 frag;
void main() {
  vec3 c = texture(uShadowRaw, vUv).rgb;
  float dark = clamp(1.0 - dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  frag = vec4(0.0, 0.0, 0.0, dark);
}
"""

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
