from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ICONS_DIR = ROOT / "src-tauri" / "icons"
ASSETS_DIR = ROOT / "src" / "assets"
MASTER_SIZE = 1024


def rounded_rect_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def vertical_gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGBA", (size, size))
    px = image.load()
    for y in range(size):
        t = y / (size - 1)
        color = tuple(int(top[i] * (1 - t) + bottom[i] * t) for i in range(3))
        for x in range(size):
            px[x, y] = (*color, 255)
    return image


def radial_glow(size: int, center: tuple[int, int], radius: int, color: tuple[int, int, int, int]) -> Image.Image:
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = glow.load()
    cx, cy = center
    for y in range(size):
        for x in range(size):
            dx = x - cx
            dy = y - cy
            distance = (dx * dx + dy * dy) ** 0.5
            if distance > radius:
                continue
            strength = 1 - distance / radius
            alpha = int(color[3] * strength * strength)
            px[x, y] = (color[0], color[1], color[2], alpha)
    return glow.filter(ImageFilter.GaussianBlur(radius=18))


def draw_terminal_portal(size: int) -> Image.Image:
    radius = 224
    canvas = vertical_gradient(size, (10, 19, 31), (3, 8, 16))
    mask = rounded_rect_mask(size, radius)
    clipped = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    clipped.paste(canvas, (0, 0), mask)

    clipped.alpha_composite(radial_glow(size, (340, 250), 330, (48, 220, 180, 115)))
    clipped.alpha_composite(radial_glow(size, (730, 770), 320, (32, 153, 255, 72)))

    draw = ImageDraw.Draw(clipped)
    draw.rounded_rectangle(
        (54, 54, size - 54, size - 54),
        radius=186,
        outline=(255, 255, 255, 24),
        width=3,
    )

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    arch_box = (266, 154, 758, 742)
    shadow_draw.arc(arch_box, start=188, end=352, fill=(0, 0, 0, 105), width=126)
    shadow_draw.line((266, 476, 266, 744), fill=(0, 0, 0, 105), width=126)
    shadow_draw.line((758, 476, 758, 744), fill=(0, 0, 0, 105), width=126)
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=28))
    clipped.alpha_composite(shadow, dest=(0, 24))

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.arc(arch_box, start=188, end=352, fill=(79, 255, 223, 155), width=116)
    glow_draw.line((266, 476, 266, 744), fill=(79, 255, 223, 155), width=116)
    glow_draw.line((758, 476, 758, 744), fill=(79, 255, 223, 155), width=116)
    clipped.alpha_composite(glow.filter(ImageFilter.GaussianBlur(radius=18)))

    draw = ImageDraw.Draw(clipped)
    tunnel_color = (177, 255, 240, 255)
    accent_color = (92, 197, 255, 255)
    draw.arc(arch_box, start=188, end=352, fill=tunnel_color, width=92)
    draw.line((266, 476, 266, 744), fill=tunnel_color, width=92)
    draw.line((758, 476, 758, 744), fill=tunnel_color, width=92)

    draw.line((146, 744, 282, 744), fill=accent_color, width=62)
    draw.line((742, 744, 878, 744), fill=accent_color, width=62)
    draw.ellipse((88, 686, 204, 802), fill=(143, 255, 227, 255))
    draw.ellipse((820, 686, 936, 802), fill=(115, 214, 255, 255))

    draw.rounded_rectangle((388, 468, 636, 674), radius=78, fill=(5, 17, 28, 230))
    draw.rounded_rectangle((404, 484, 620, 658), radius=64, outline=(185, 255, 246, 90), width=4)
    draw.line((442, 570, 514, 514), fill=(195, 255, 247, 255), width=28)
    draw.line((514, 514, 584, 570), fill=(195, 255, 247, 255), width=28)
    draw.line((454, 620, 572, 620), fill=(95, 206, 255, 255), width=24)

    return clipped


def save_resized(master: Image.Image, name: str, size: int) -> None:
    master.resize((size, size), Image.Resampling.LANCZOS).save(ICONS_DIR / name)


def main() -> None:
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    master = draw_terminal_portal(MASTER_SIZE)
    master.save(ICONS_DIR / "icon.png")
    master.resize((512, 512), Image.Resampling.LANCZOS).save(ASSETS_DIR / "app-icon.png")

    save_resized(master, "32x32.png", 32)
    save_resized(master, "128x128.png", 128)
    save_resized(master, "128x128@2x.png", 256)
    save_resized(master, "Square30x30Logo.png", 30)
    save_resized(master, "Square44x44Logo.png", 44)
    save_resized(master, "Square71x71Logo.png", 71)
    save_resized(master, "Square89x89Logo.png", 89)
    save_resized(master, "Square107x107Logo.png", 107)
    save_resized(master, "Square142x142Logo.png", 142)
    save_resized(master, "Square150x150Logo.png", 150)
    save_resized(master, "Square284x284Logo.png", 284)
    save_resized(master, "Square310x310Logo.png", 310)
    save_resized(master, "StoreLogo.png", 50)

    master.save(
        ICONS_DIR / "icon.ico",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    master.save(ICONS_DIR / "icon.icns")


if __name__ == "__main__":
    main()
