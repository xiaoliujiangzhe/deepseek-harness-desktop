from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
INPUT_DIR = ROOT / "assets" / "stickers" / "whale-girl-v1" / "png"
OUTPUT_DIR = ROOT / "assets" / "stickers" / "whale-girl-v1" / "captioned"
PREVIEW_PATH = ROOT / "assets" / "stickers" / "whale-girl-v1" / "preview.png"
FONT_PATH = Path(r"C:\Windows\Fonts\msyhbd.ttc")

CAPTIONS = {
    "01-steal-rice.png": "正在偷吃白饭",
    "02-hooray.png": "好耶！",
    "03-thinking.png": "让我想想",
    "04-code-crash.png": "代码炸了",
    "05-sorry.png": "对不起嘛",
    "06-shocked.png": "什么？！",
}


def fit_subject(image: Image.Image, max_width: int, max_height: int) -> Image.Image:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        return image
    cropped = image.crop(bbox)
    scale = min(max_width / cropped.width, max_height / cropped.height)
    size = (max(1, round(cropped.width * scale)), max(1, round(cropped.height * scale)))
    return cropped.resize(size, Image.Resampling.LANCZOS)


def build_captioned(source: Path, caption: str) -> Image.Image:
    canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    subject = fit_subject(Image.open(source).convert("RGBA"), 900, 790)
    subject_x = (canvas.width - subject.width) // 2
    subject_y = max(20, 790 - subject.height)
    canvas.alpha_composite(subject, (subject_x, subject_y))

    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype(str(FONT_PATH), 104)
    text_box = draw.textbbox((0, 0), caption, font=font, stroke_width=0)
    text_width = text_box[2] - text_box[0]
    text_x = (canvas.width - text_width) // 2
    text_y = 835
    draw.text(
        (text_x + 5, text_y + 8),
        caption,
        font=font,
        fill=(38, 92, 158, 210),
        stroke_width=12,
        stroke_fill=(38, 92, 158, 180),
    )
    draw.text(
        (text_x, text_y),
        caption,
        font=font,
        fill=(255, 255, 255, 255),
        stroke_width=8,
        stroke_fill=(17, 43, 82, 255),
    )
    return canvas


def build_preview(stickers: list[tuple[str, Image.Image]]) -> Image.Image:
    preview = Image.new("RGB", (1920, 1360), (10, 26, 51))
    draw = ImageDraw.Draw(preview)
    title_font = ImageFont.truetype(str(FONT_PATH), 72)
    small_font = ImageFont.truetype(str(FONT_PATH), 30)
    draw.text((80, 48), "鲸鱼娘表情包 · 第一组", font=title_font, fill=(238, 248, 255))
    draw.text((82, 140), "DeepSeek Harness Desktop · XLJZ", font=small_font, fill=(104, 196, 235))

    tile_size = 540
    gap_x = 70
    gap_y = 55
    start_x = 80
    start_y = 215
    for index, (caption, sticker) in enumerate(stickers):
        row, col = divmod(index, 3)
        x = start_x + col * (tile_size + gap_x)
        y = start_y + row * (tile_size + gap_y)
        draw.rounded_rectangle(
            (x, y, x + tile_size, y + tile_size),
            radius=42,
            fill=(20, 48, 83),
            outline=(54, 137, 192),
            width=3,
        )
        item = sticker.resize((500, 500), Image.Resampling.LANCZOS)
        preview.paste(item, (x + 20, y + 13), item)
    return preview


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    preview_items: list[tuple[str, Image.Image]] = []
    for filename, caption in CAPTIONS.items():
        source = INPUT_DIR / filename
        if not source.exists():
            continue
        sticker = build_captioned(source, caption)
        sticker.save(OUTPUT_DIR / filename, optimize=True)
        preview_items.append((caption, sticker))

    build_preview(preview_items).save(PREVIEW_PATH, optimize=True)
    print(f"Built {len(preview_items)} captioned stickers")
    print(PREVIEW_PATH)


if __name__ == "__main__":
    main()
