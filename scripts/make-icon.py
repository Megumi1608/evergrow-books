from PIL import Image, ImageDraw

SIZE = 1024
img = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=int(SIZE * 0.27), fill=(30, 91, 69, 255))

cream = (244, 240, 229, 255)
bar_width = int(SIZE * 0.115)
radius = bar_width // 2
bars = [
    (0.235, 0.545, 0.300),
    (0.4425, 0.735, 0.480),
    (0.650, 0.805, 0.640),
]
for x_ratio, bottom_ratio, height_ratio in bars:
    x = int(SIZE * x_ratio)
    bottom = int(SIZE * bottom_ratio)
    top = bottom - int(SIZE * height_ratio)
    draw.rounded_rectangle([x, top, x + bar_width, bottom], radius=radius, fill=cream)

img.save('build/icon.png')
sizes = [16, 24, 32, 48, 64, 128, 256]
img.save('build/icon.ico', sizes=[(s, s) for s in sizes])
print('Wrote build/icon.png and build/icon.ico')
