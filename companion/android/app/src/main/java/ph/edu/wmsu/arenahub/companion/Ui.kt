package ph.edu.wmsu.arenahub.companion

import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView

/** ArenaHub's colours, the same tokens as the website and the PC agent window. */
class Palette(dark: Boolean) {
    val bg = if (dark) 0xFF0E0E10.toInt() else 0xFFF4F4F5.toInt()
    val card = if (dark) 0xFF18181B.toInt() else 0xFFFFFFFF.toInt()
    val raise = if (dark) 0xFF1F1F23.toInt() else 0xFFFAFAFA.toInt()
    val text = if (dark) 0xFFEFEFF1.toInt() else 0xFF18181B.toInt()
    val muted = if (dark) 0xFFA1A1AA.toInt() else 0xFF52525B.toInt()
    val line = if (dark) 0xFF2E2E33.toInt() else 0xFFE4E4E7.toInt()
    val lineStrong = if (dark) 0xFF3F3F46.toInt() else 0xFFD4D4D8.toInt()
    val brand = 0xFFFF6600.toInt()
    val onBrand = 0xFF1A0B00.toInt()
    val brandInk = if (dark) 0xFFFF8A3D.toInt() else 0xFFC2410C.toInt()
    val ok = if (dark) 0xFF4ADE80.toInt() else 0xFF15803D.toInt()
    val bad = if (dark) 0xFFF87171.toInt() else 0xFFB91C1C.toInt()
    val warn = if (dark) 0xFFFBBF24.toInt() else 0xFFA16207.toInt()
    fun tone(tone: Tone) = when (tone) { Tone.OK -> ok; Tone.BAD -> bad; Tone.WARN -> warn; Tone.INFO -> brandInk }
    /** A see-through wash of a tone colour, for badge and finding backgrounds. */
    fun soft(color: Int, alpha: Int = 0x24) = (color and 0x00FFFFFF) or (alpha shl 24)

    companion object {
        fun of(context: Context) = Palette((context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES)
    }
}

/** Small view builders so every screen uses the same sizes, shapes and colours. */
class Ui(private val context: Context, val c: Palette) {
    fun dp(value: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, context.resources.displayMetrics).toInt()
    fun dp(value: Int) = dp(value.toFloat())
    private val bold = Typeface.create(Typeface.DEFAULT, 700, false)
    private val semibold = Typeface.create(Typeface.DEFAULT, 600, false)
    private val mono = Typeface.create(Typeface.MONOSPACE, 600, false)

    fun shape(fill: Int, radius: Int, stroke: Int? = null) = GradientDrawable().apply {
        setColor(fill); cornerRadius = dp(radius).toFloat()
        if (stroke != null) setStroke(dp(1), stroke)
    }
    private fun lp(width: Int = ViewGroup.LayoutParams.MATCH_PARENT, top: Int = 0) = LinearLayout.LayoutParams(width, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }

    fun column(gap: Int = 0) = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; if (gap > 0) { showDividers = LinearLayout.SHOW_DIVIDER_MIDDLE; dividerDrawable = GradientDrawable().apply { setSize(0, dp(gap)) } } }
    fun card(top: Int = 14) = column().apply { background = shape(c.card, 16, c.line); setPadding(dp(20), dp(20), dp(20), dp(20)); layoutParams = lp(top = top) }

    fun text(value: CharSequence, size: Float = 15f, color: Int = c.text, weight: Int = 400, top: Int = 0, center: Boolean = false) = TextView(context).apply {
        text = value; textSize = size; setTextColor(color); setLineSpacing(0f, 1.25f)
        typeface = when { weight >= 700 -> bold; weight >= 600 -> semibold; else -> Typeface.DEFAULT }
        if (center) gravity = Gravity.CENTER_HORIZONTAL
        layoutParams = lp(top = top)
    }
    fun title(value: CharSequence, center: Boolean = false, size: Float = 26f) = text(value, size, c.text, 700, center = center).apply { letterSpacing = -0.01f }
    fun muted(value: CharSequence, size: Float = 14f, top: Int = 6, center: Boolean = false) = text(value, size, c.muted, top = top, center = center)
    fun heading(value: CharSequence, top: Int = 0) = text(value, 15f, c.text, 650, top = top).apply { setPadding(0, 0, 0, dp(8)) }

    fun icon(res: Int, color: Int, size: Int = 20) = ImageView(context).apply {
        setImageResource(res); imageTintList = ColorStateList.valueOf(color)
        layoutParams = FrameLayout.LayoutParams(dp(size), dp(size), Gravity.CENTER)
    }
    /** A round badge with an icon, or a spinner when [res] is null. */
    fun badge(res: Int?, tone: Tone, size: Int = 72) = FrameLayout(context).apply {
        val color = c.tone(tone)
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(c.soft(color)) }
        addView(if (res == null) spinner(color, size / 2) else icon(res, color, size * 34 / 72))
        layoutParams = LinearLayout.LayoutParams(dp(size), dp(size)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(16) }
    }
    fun spinner(color: Int, size: Int = 20) = ProgressBar(context).apply {
        isIndeterminate = true; indeterminateTintList = ColorStateList.valueOf(color)
        layoutParams = FrameLayout.LayoutParams(dp(size), dp(size), Gravity.CENTER)
    }

    private fun button(label: String, iconRes: Int?, fill: Int, ink: Int, stroke: Int?, onClick: () -> Unit) = Button(context).apply {
        text = label; isAllCaps = false; textSize = 16f; typeface = semibold; setTextColor(ink)
        stateListAnimator = null; minHeight = dp(52); minimumHeight = dp(52)
        setPadding(dp(18), dp(12), dp(18), dp(12))
        background = RippleDrawable(ColorStateList.valueOf(c.soft(if (fill == c.brand) c.onBrand else c.text, 0x22)), shape(fill, 12, stroke), shape(0xFF000000.toInt(), 12))
        // The icon sits beside the label (a compound drawable would pin it to the button's edge).
        if (iconRes != null) {
            val glyph = context.getDrawable(iconRes)!!.mutate().apply { setBounds(0, 0, dp(20), dp(20)); setTint(ink) }
            text = android.text.SpannableStringBuilder("  $label").apply { setSpan(android.text.style.ImageSpan(glyph, android.text.style.DynamicDrawableSpan.ALIGN_CENTER), 0, 1, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE) }
        }
        setOnClickListener { onClick() }
        layoutParams = lp(top = 10)
    }
    fun primary(label: String, iconRes: Int? = null, onClick: () -> Unit) = button(label, iconRes, c.brand, c.onBrand, null, onClick)
    fun ghost(label: String, iconRes: Int? = null, onClick: () -> Unit) = button(label, iconRes, 0x00000000, c.text, c.lineStrong, onClick)
    fun danger(label: String, iconRes: Int? = null, onClick: () -> Unit) = button(label, iconRes, 0x00000000, c.bad, c.lineStrong, onClick)
    fun link(label: String, onClick: () -> Unit) = text(label, 14f, c.brandInk, 600, top = 14).apply {
        setPadding(0, dp(6), 0, dp(6)); isClickable = true; isFocusable = true; setOnClickListener { onClick() }
    }

    fun input(hint: String, code: Boolean = false) = EditText(context).apply {
        this.hint = hint; isSingleLine = true; setTextColor(c.text); setHintTextColor(c.muted)
        background = shape(c.bg, 10, c.lineStrong); setPadding(dp(14), dp(12), dp(14), dp(12)); minHeight = dp(52)
        if (code) {
            typeface = mono; textSize = 22f; letterSpacing = 0.2f
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            filters = arrayOf(android.text.InputFilter.AllCaps(), android.text.InputFilter.LengthFilter(8))
        } else { textSize = 15f; inputType = InputType.TYPE_TEXT_VARIATION_URI }
        layoutParams = lp(top = 6)
    }
    fun label(value: String, top: Int = 14) = text(value, 13f, c.text, 600, top = top)

    /** An icon tile, a bold title and a muted line: used for "this scan checks" and progress rows. */
    fun row(iconView: View, tint: Int?, title: String, detail: String?, top: Int = 0) = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL; layoutParams = lp(top = top); setPadding(0, dp(10), 0, dp(10))
        addView(FrameLayout(context).apply {
            background = if (tint == null) shape(c.raise, 10, c.line) else shape(c.soft(tint), 10)
            addView(iconView)
            layoutParams = LinearLayout.LayoutParams(dp(38), dp(38)).apply { marginEnd = dp(14) }
        })
        addView(column().apply {
            addView(text(title, 15f, c.text, 600))
            if (!detail.isNullOrBlank()) addView(muted(detail, 13.5f, top = 2))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
    }
    fun infoRow(res: Int, title: String, detail: String?) = row(icon(res, c.muted), null, title, detail)

    /** One finding: a red cross for what blocks, an amber triangle for what is only worth knowing. */
    fun finding(raw: String, soft: Boolean) = LinearLayout(context).apply {
        val line = findingLine(raw)
        orientation = LinearLayout.HORIZONTAL
        background = if (soft) shape(c.raise, 12, c.line) else shape(c.soft(c.bad, 0x1E), 12, c.line)
        setPadding(dp(14), dp(12), dp(14), dp(12)); layoutParams = lp(top = 8)
        addView(icon(if (soft) R.drawable.ic_alert else R.drawable.ic_x, if (soft) c.warn else c.bad, 20).apply { layoutParams = LinearLayout.LayoutParams(dp(20), dp(20)).apply { marginEnd = dp(12); topMargin = dp(1) } })
        addView(column().apply {
            addView(text(line.title, 15f, c.text, if (line.detail == null) 500 else 600))
            if (line.detail != null) addView(muted(line.detail, 13.5f, top = 2))
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        })
    }
    /** A rounded "pill" with an optional leading dot or icon, for live status and times. */
    fun pill(value: String, dot: Int? = null, iconRes: Int? = null) = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        background = shape(0x00000000, 999, c.line); setPadding(dp(12), dp(5), dp(12), dp(5))
        if (dot != null) addView(View(context).apply { background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(dot) }; layoutParams = LinearLayout.LayoutParams(dp(8), dp(8)).apply { marginEnd = dp(6) } })
        if (iconRes != null) addView(icon(iconRes, c.muted, 14).apply { layoutParams = LinearLayout.LayoutParams(dp(14), dp(14)).apply { marginEnd = dp(6) } })
        addView(text(value, 13f, c.muted).apply { layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT) })
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8); marginEnd = dp(8) }
    }
    /** A quiet box with an icon, for "never touched" and the server address. */
    fun note(res: Int, body: View, top: Int = 14) = LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL; background = shape(c.raise, 12, c.line)
        setPadding(dp(14), dp(12), dp(14), dp(12)); layoutParams = lp(top = top)
        addView(icon(res, c.muted, 20).apply { layoutParams = LinearLayout.LayoutParams(dp(20), dp(20)).apply { marginEnd = dp(12); topMargin = dp(1) } })
        body.layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        addView(body)
    }
}
