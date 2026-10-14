import math
import random
import subprocess
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

def render_1080p_mp4():
    width = 1920
    height = 1080
    fps = 60
    duration_sec = 5.6
    total_frames = int(fps * duration_sec)
    
    font_title_path = "C:/Windows/Fonts/bahnschrift.ttf"
    font_sub_path = "C:/Windows/Fonts/segoeui.ttf"
    font_mono_path = "C:/Windows/Fonts/consola.ttf"
    
    font_manual = ImageFont.truetype(font_title_path, 120)
    font_manual_sub = ImageFont.truetype(font_mono_path, 34)
    
    font_ichno = ImageFont.truetype(font_title_path, 138)
    font_ichno_sub = ImageFont.truetype(font_sub_path, 48)
    font_badge = ImageFont.truetype(font_mono_path, 25)
    
    manual_txt = "MANUAL TRIAGE"
    bbox = font_manual.getbbox(manual_txt)
    txt_w = bbox[2] - bbox[0]
    txt_h = bbox[3] - bbox[1]
    
    text_img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(text_img)
    x_pos = (width - txt_w) // 2
    y_pos = (height - txt_h) // 2 - 40
    d.text((x_pos, y_pos), manual_txt, font=font_manual, fill=(220, 90, 90, 255))
    
    random.seed(42)
    shards = []
    cell_size = 40
    
    for cy in range(y_pos - 10, y_pos + txt_h + 20, cell_size):
        for cx in range(x_pos - 20, x_pos + txt_w + 30, cell_size):
            sample_box = (max(0, int(cx)), max(0, int(cy)), min(width, int(cx + cell_size)), min(height, int(cy + cell_size)))
            crop = text_img.crop(sample_box)
            alpha_arr = np.array(crop)[:, :, 3] if crop.size[0] > 0 and crop.size[1] > 0 else np.array([])
            
            if np.any(alpha_arr > 30):
                center_x = cx + random.uniform(2, cell_size - 2)
                center_y = cy + random.uniform(2, cell_size - 2)
                num_pts = random.randint(3, 5)
                pts = []
                base_angle = random.uniform(0, 2 * math.pi)
                for i in range(num_pts):
                    ang = base_angle + (i / num_pts) * 2 * math.pi + random.uniform(-0.3, 0.3)
                    r = random.uniform(12, 30)
                    pts.append([r * math.cos(ang), r * math.sin(ang)])
                
                dx = center_x - width / 2
                dy = center_y - (y_pos + txt_h / 2)
                dist = max(10, math.sqrt(dx * dx + dy * dy))
                speed = random.uniform(20, 50) * (1.0 + (dist / 220))
                angle = math.atan2(dy, dx) + random.uniform(-0.35, 0.35)
                
                vx = math.cos(angle) * speed
                vy = math.sin(angle) * speed - random.uniform(5, 14)
                rot_speed = random.uniform(-0.15, 0.15)
                
                shards.append({
                    "orig_cx": center_x,
                    "orig_cy": center_y,
                    "pts": np.array(pts, dtype=np.float32),
                    "vx": vx,
                    "vy": vy,
                    "rot_speed": rot_speed,
                    "color": (random.randint(180, 240), random.randint(60, 100), random.randint(70, 110)),
                    "size_scale": random.uniform(0.8, 1.4)
                })

    bg_particles = []
    for _ in range(90):
        bg_particles.append({
            "x": random.uniform(0, width),
            "y": random.uniform(0, height),
            "vx": random.uniform(-0.5, 0.5),
            "vy": random.uniform(-0.4, 0.4),
            "radius": random.uniform(1.5, 3.5),
            "alpha": random.uniform(0.15, 0.5),
            "color": random.choice([(140, 90, 255), (60, 210, 255), (100, 150, 255)])
        })

    output_mp4 = "d:/Ichnoscope-WCC-30/docs/assets/manual-triage-shatter-1080p.mp4"
    ffmpeg_cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{width}x{height}",
        "-pix_fmt", "bgr24",
        "-r", str(fps),
        "-i", "-",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-crf", "17",
        "-preset", "fast",
        output_mp4
    ]
    
    proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE)
    
    shatter_frame = int(1.3 * fps) # at 1.3s
    
    for frame_idx in range(total_frames):
        t = frame_idx / fps
        img = Image.new("RGB", (width, height), (11, 13, 19))
        draw = ImageDraw.Draw(img)
        
        # Grid lines
        for gx in range(0, width, 96):
            draw.line([(gx, 0), (gx, height)], fill=(30, 38, 55))
        for gy in range(0, height, 96):
            draw.line([(0, gy), (width, gy)], fill=(30, 38, 55))
            
        for p in bg_particles:
            px = (p["x"] + p["vx"] * frame_idx) % width
            py = (p["y"] + p["vy"] * frame_idx) % height
            r = p["radius"]
            draw.ellipse([(px - r, py - r), (px + r, py + r)], fill=p["color"])

        frame_cv = np.array(img)
        frame_cv = cv2.cvtColor(frame_cv, cv2.COLOR_RGB2BGR)

        # Phase 1: Manual Triage
        if frame_idx < shatter_frame:
            alpha = min(1.0, frame_idx / (0.4 * fps))
            pulse = 0.85 + 0.15 * math.sin(frame_idx * 0.15)
            red_intensity = int(220 * pulse)
            
            jx = 0
            jy = 0
            if frame_idx > int(0.9 * fps):
                shake = (frame_idx - int(0.9 * fps)) * 0.4
                jx = random.uniform(-shake, shake)
                jy = random.uniform(-shake, shake)
            
            overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            odraw = ImageDraw.Draw(overlay)
            
            glow_col = (red_intensity, 40, 50, int(70 * alpha))
            odraw.text((x_pos + jx - 3, y_pos + jy), manual_txt, font=font_manual, fill=glow_col)
            odraw.text((x_pos + jx + 3, y_pos + jy), manual_txt, font=font_manual, fill=glow_col)
            odraw.text((x_pos + jx, y_pos + jy - 3), manual_txt, font=font_manual, fill=glow_col)
            odraw.text((x_pos + jx, y_pos + jy + 3), manual_txt, font=font_manual, fill=glow_col)
            
            main_col = (int(235 * alpha), int(95 * alpha), int(95 * alpha), int(255 * alpha))
            odraw.text((x_pos + jx, y_pos + jy), manual_txt, font=font_manual, fill=main_col)
            
            sub_txt = "[ SLOW • FRAGMENTED • INCIDENT FATIGUE ]"
            sbbox = font_manual_sub.getbbox(sub_txt)
            sx = (width - (sbbox[2] - sbbox[0])) // 2
            sy = y_pos + txt_h + 40
            odraw.text((sx + jx, sy + jy), sub_txt, font=font_manual_sub, fill=(160, 80, 80, int(200 * alpha)))
            
            if frame_idx >= int(0.9 * fps):
                crack_progress = (frame_idx - int(0.9 * fps)) / (0.4 * fps)
                cracks = [
                    [(x_pos + 180, y_pos + 30), (x_pos + 280, y_pos + 70), (x_pos + 350, y_pos + 60), (x_pos + 440, y_pos + 110)],
                    [(x_pos + 560, y_pos + 15), (x_pos + 620, y_pos + 60), (x_pos + 680, y_pos + 45), (x_pos + 750, y_pos + 105)],
                ]
                for crack in cracks:
                    max_pt = int(len(crack) * crack_progress) + 1
                    for ci in range(min(max_pt, len(crack) - 1)):
                        odraw.line([crack[ci], crack[ci+1]], fill=(255, 140, 50, 240), width=3)
            
            img_rgba = Image.fromarray(cv2.cvtColor(frame_cv, cv2.COLOR_BGR2RGBA))
            img_rgba = Image.alpha_composite(img_rgba, overlay)
            frame_cv = cv2.cvtColor(np.array(img_rgba), cv2.COLOR_RGBA2BGR)

        # Phase 2: Shatter
        if frame_idx >= shatter_frame and frame_idx < (shatter_frame + int(1.4 * fps)):
            df = frame_idx - shatter_frame
            dt = df / fps
            shock_r = int(dt * 1050)
            shock_alpha = max(0, 1.0 - (df / (1.1 * fps)))
            if shock_alpha > 0 and shock_r > 0:
                cv2.circle(frame_cv, (width // 2, y_pos + txt_h // 2), shock_r, (int(255 * shock_alpha), int(200 * shock_alpha), int(255 * shock_alpha)), max(1, int(5 * shock_alpha)))
                cv2.circle(frame_cv, (width // 2, y_pos + txt_h // 2), int(shock_r * 0.88), (int(80 * shock_alpha), int(60 * shock_alpha), int(255 * shock_alpha)), max(1, int(3 * shock_alpha)))
            
            if df < int(0.12 * fps):
                flash_val = int((1.0 - df / (0.12 * fps)) * 130)
                frame_cv = cv2.add(frame_cv, np.full_like(frame_cv, flash_val))
            
            gravity = 750.0
            shard_fade = max(0.0, 1.0 - (df / (1.2 * fps)))
            
            for s in shards:
                cur_x = s["orig_cx"] + s["vx"] * dt
                cur_y = s["orig_cy"] + s["vy"] * dt + 0.5 * gravity * (dt ** 2)
                cur_rot = s["rot_speed"] * df
                
                cos_r = math.cos(cur_rot)
                sin_r = math.sin(cur_rot)
                R = np.array([[cos_r, -sin_r], [sin_r, cos_r]], dtype=np.float32)
                transformed_pts = (s["pts"] @ R.T) * s["size_scale"] + np.array([cur_x, cur_y])
                int_pts = np.int32([transformed_pts])
                
                col = (int(s["color"][2] * shard_fade), int(s["color"][1] * shard_fade), int(s["color"][0] * shard_fade))
                cv2.fillPoly(frame_cv, int_pts, col)
                cv2.polylines(frame_cv, int_pts, True, (int(255 * shard_fade), int(150 * shard_fade), int(100 * shard_fade)), 1)

        # Phase 3: Ichnoscope Emergence
        ichno_start = int(2.0 * fps)
        if frame_idx >= ichno_start:
            it = (frame_idx - ichno_start) / fps
            fade_in = min(1.0, it / 0.8)
            
            if it < 1.2:
                burst_radius = int(min(width, (it / 1.2) * 800))
                burst_alpha = max(0.0, math.sin(it / 1.2 * math.pi) * 0.4)
                overlay_b = frame_cv.copy()
                cv2.circle(overlay_b, (width // 2, height // 2 - 40), burst_radius, (255, 120, 200), -1)
                cv2.addWeighted(overlay_b, burst_alpha, frame_cv, 1.0 - burst_alpha, 0, frame_cv)

            overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
            odraw = ImageDraw.Draw(overlay)
            
            ichno_txt = "ICHNOSCOPE"
            ibbox = font_ichno.getbbox(ichno_txt)
            iw = ibbox[2] - ibbox[0]
            ih = ibbox[3] - ibbox[1]
            
            ix = (width - iw) // 2
            iy = (height - ih) // 2 - 65
            
            glow_layers = [
                (18, (168, 85, 247, int(50 * fade_in))),
                (12, (56, 189, 248, int(80 * fade_in))),
                (6, (192, 132, 252, int(130 * fade_in))),
            ]
            for radius, col in glow_layers:
                for off_x in (-radius, 0, radius):
                    for off_y in (-radius, 0, radius):
                        if off_x != 0 or off_y != 0:
                            odraw.text((ix + off_x, iy + off_y), ichno_txt, font=font_ichno, fill=col)
            
            odraw.text((ix, iy), ichno_txt, font=font_ichno, fill=(245, 252, 255, int(255 * fade_in)))
            
            # Divider
            bar_start = ichno_start + int(0.5 * fps)
            if frame_idx >= bar_start:
                bar_t = min(1.0, (frame_idx - bar_start) / (0.8 * fps))
                bar_max_w = iw + 180
                bar_w = bar_max_w * (1.0 - math.pow(1.0 - bar_t, 3))
                bx1 = (width - bar_w) / 2
                bx2 = bx1 + bar_w
                by = iy + ih + 30
                
                odraw.line([(bx1, by), (bx2, by)], fill=(56, 189, 248, int(240 * bar_t)), width=4)
                odraw.line([(bx1, by-2), (bx2, by-2)], fill=(168, 85, 247, int(150 * bar_t)), width=2)
                odraw.line([(bx1, by+2), (bx2, by+2)], fill=(168, 85, 247, int(150 * bar_t)), width=2)

            # Subtitle
            sub_start = ichno_start + int(0.8 * fps)
            if frame_idx >= sub_start:
                sub_it = min(1.0, (frame_idx - sub_start) / (0.7 * fps))
                sub_y_off = (1.0 - sub_it) * 20
                
                sub_text = "Event-Driven Agent Orchestration"
                sbbox = font_ichno_sub.getbbox(sub_text)
                sw = sbbox[2] - sbbox[0]
                sx = (width - sw) // 2
                sy = iy + ih + 60 + sub_y_off
                
                odraw.text((sx - 2, sy), sub_text, font=font_ichno_sub, fill=(56, 189, 248, int(90 * sub_it)))
                odraw.text((sx + 2, sy), sub_text, font=font_ichno_sub, fill=(56, 189, 248, int(90 * sub_it)))
                odraw.text((sx, sy), sub_text, font=font_ichno_sub, fill=(225, 245, 255, int(255 * sub_it)))

            # Bottom badge
            badge_start = ichno_start + int(1.2 * fps)
            if frame_idx >= badge_start:
                badge_t = min(1.0, (frame_idx - badge_start) / (0.6 * fps))
                badge_text = "DETERMINISTIC CODE BLAME  •  BOUNDED LLM EXPLANATION  •  HUMAN SIGN-OFF"
                bb_box = font_badge.getbbox(badge_text)
                bw = bb_box[2] - bb_box[0]
                bx = (width - bw) // 2
                by_pos = height - 130
                
                pad_x = 36
                pad_y = 12
                pill_rect = [(bx - pad_x, by_pos - pad_y), (bx + bw + pad_x, by_pos + (bb_box[3] - bb_box[1]) + pad_y)]
                odraw.rounded_rectangle(pill_rect, radius=10, fill=(18, 24, 38, int(220 * badge_t)), outline=(60, 80, 120, int(150 * badge_t)), width=2)
                odraw.text((bx, by_pos), badge_text, font=font_badge, fill=(130, 180, 230, int(230 * badge_t)))

            img_rgba = Image.fromarray(cv2.cvtColor(frame_cv, cv2.COLOR_BGR2RGBA))
            img_rgba = Image.alpha_composite(img_rgba, overlay)
            frame_cv = cv2.cvtColor(np.array(img_rgba), cv2.COLOR_RGBA2BGR)

        # Pipe frame directly into ffmpeg stdin
        proc.stdin.write(frame_cv.tobytes())

    proc.stdin.close()
    proc.wait()
    print(f"1080p 60fps MP4 successfully rendered to {output_mp4}")

if __name__ == "__main__":
    render_1080p_mp4()
