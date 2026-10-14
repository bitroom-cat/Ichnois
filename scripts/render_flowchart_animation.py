import math
import subprocess
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

def render_flowchart():
    width = 1920
    height = 1080
    fps = 60
    duration_sec = 8.5
    total_frames = int(fps * duration_sec)
    
    font_title_path = "C:/Windows/Fonts/bahnschrift.ttf"
    font_sub_path = "C:/Windows/Fonts/segoeui.ttf"
    font_mono_path = "C:/Windows/Fonts/consola.ttf"
    
    font_header = ImageFont.truetype(font_title_path, 60)
    font_header_sub = ImageFont.truetype(font_sub_path, 28)
    font_node_title = ImageFont.truetype(font_title_path, 28)
    font_node_desc = ImageFont.truetype(font_mono_path, 17)
    font_footer = ImageFont.truetype(font_mono_path, 22)
    
    # Define 5 Nodes along a clean horizontal layout
    # Center y = 520
    nodes = [
        {
            "id": 0,
            "title": "Crash Event",
            "desc": "Sentry Webhook\nPayload Ingest",
            "color": (239, 68, 68),       # Red
            "glow": (239, 68, 68),
            "light_time": 0.6,
        },
        {
            "id": 1,
            "title": "LangGraph\nOrchestrator",
            "desc": "State Graph\nAgent Dispatch",
            "color": (168, 85, 247),      # Violet/Purple
            "glow": (168, 85, 247),
            "light_time": 2.0,
        },
        {
            "id": 2,
            "title": "Log Parser",
            "desc": "Stack Trace\nDeduplication",
            "color": (56, 189, 248),      # Cyan
            "glow": (56, 189, 248),
            "light_time": 3.4,
        },
        {
            "id": 3,
            "title": "Git Correlator",
            "desc": "GraphQL Blame\nRelease SHA Diff",
            "color": (16, 185, 129),      # Emerald
            "glow": (16, 185, 129),
            "light_time": 4.8,
        },
        {
            "id": 4,
            "title": "GitHub Issue",
            "desc": "Draft & Publish\n3-Step Checklist",
            "color": (245, 158, 11),      # Amber/Gold
            "glow": (245, 158, 11),
            "light_time": 6.2,
        }
    ]
    
    node_w = 260
    node_h = 160
    y_center = 510
    total_w = 1700
    spacing = (total_w - (5 * node_w)) / 4
    start_x = (width - total_w) / 2
    
    for i, n in enumerate(nodes):
        nx = start_x + i * (node_w + spacing)
        n["x"] = nx
        n["y"] = y_center - node_h / 2
        n["cx"] = nx + node_w / 2
        n["cy"] = y_center

    output_mp4 = "d:/Ichnoscope-WCC-30/docs/assets/flowchart-orchestrator-animation.mp4"
    
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
    
    print(f"Rendering {total_frames} frames for flowchart motion graphic...")
    
    for frame_idx in range(total_frames):
        t = frame_idx / fps
        
        # Deep space dark canvas
        img = Image.new("RGB", (width, height), (11, 13, 19))
        draw = ImageDraw.Draw(img)
        
        # Cyber grid
        for gx in range(0, width, 80):
            draw.line([(gx, 0), (gx, height)], fill=(20, 26, 40))
        for gy in range(0, height, 80):
            draw.line([(0, gy), (width, gy)], fill=(20, 26, 40))
            
        frame_cv = np.array(img)
        frame_cv = cv2.cvtColor(frame_cv, cv2.COLOR_RGB2BGR)

        # Header Title
        overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        odraw = ImageDraw.Draw(overlay)
        
        # Header fade-in
        h_alpha = min(1.0, t / 0.8)
        head_txt = "INCIDENT RESOLUTION PIPELINE"
        hb = font_header.getbbox(head_txt)
        hw = hb[2] - hb[0]
        odraw.text(((width - hw) // 2, 110), head_txt, font=font_header, fill=(245, 250, 255, int(255 * h_alpha)))
        
        sub_head = "Event-Driven Autonomous State Machine"
        shb = font_header_sub.getbbox(sub_head)
        shw = shb[2] - shb[0]
        odraw.text(((width - shw) // 2, 185), sub_head, font=font_header_sub, fill=(56, 189, 248, int(210 * h_alpha)))

        # Draw connecting arrows/tracks between nodes
        for i in range(len(nodes) - 1):
            n1 = nodes[i]
            n2 = nodes[i+1]
            x1 = int(n1["x"] + node_w)
            x2 = int(n2["x"])
            y = int(y_center)
            
            # Base dark track
            cv2.line(frame_cv, (x1, y), (x2, y), (40, 50, 75), 4)
            
            # Beam animation between n1 light_time and n2 light_time
            t_start = n1["light_time"] + 0.3
            t_end = n2["light_time"]
            
            if t >= t_start:
                beam_progress = min(1.0, (t - t_start) / max(0.01, (t_end - t_start)))
                cur_beam_x = int(x1 + (x2 - x1) * beam_progress)
                
                # Active glowing laser line
                col = n1["color"]
                bgr_col = (col[2], col[1], col[0])
                cv2.line(frame_cv, (x1, y), (cur_beam_x, y), bgr_col, 5)
                # Outer glow line
                cv2.line(frame_cv, (x1, y), (cur_beam_x, y), (255, 255, 255), 2)
                
                # Laser packet spark at tip
                if beam_progress < 1.0:
                    cv2.circle(frame_cv, (cur_beam_x, y), 9, (255, 255, 255), -1)
                    cv2.circle(frame_cv, (cur_beam_x, y), 16, bgr_col, 2)
                
                # Right arrow head when reached
                if beam_progress >= 0.95:
                    pts = np.array([[x2 - 12, y - 10], [x2, y], [x2 - 12, y + 10]], np.int32)
                    cv2.fillPoly(frame_cv, [pts], bgr_col)

        # Draw the 5 Nodes
        for n in nodes:
            is_lit = t >= n["light_time"]
            lit_dt = max(0.0, t - n["light_time"])
            
            nx = int(n["x"])
            ny = int(n["y"])
            r_col = n["color"]
            
            if not is_lit:
                # Dim unlit card
                card_bg = (18, 22, 32)
                border_col = (45, 55, 75)
                odraw.rounded_rectangle([(nx, ny), (nx + node_w, ny + node_h)], radius=14, fill=(*card_bg, 220), outline=(*border_col, 150), width=2)
                
                # Dim text
                odraw.text((nx + 20, ny + 20), n["title"], font=font_node_title, fill=(100, 115, 140, 180))
                odraw.text((nx + 20, ny + 95), n["desc"], font=font_node_desc, fill=(70, 85, 110, 150))
            else:
                # Node powers on! Flash burst
                lit_progress = min(1.0, lit_dt / 0.5)
                flash_burst = max(0.0, math.sin(min(1.0, lit_dt / 0.4) * math.pi))
                
                # Glowing shadow ring
                glow_r = int(14 + flash_burst * 25)
                cv2.rectangle(frame_cv, (nx - 4, ny - 4), (nx + node_w + 4, ny + node_h + 4), (r_col[2], r_col[1], r_col[0]), 2)
                
                # Radiant lit card background
                card_bg = (24, 30, 48)
                odraw.rounded_rectangle([(nx, ny), (nx + node_w, ny + node_h)], radius=14, fill=(*card_bg, 245), outline=(*r_col, int(255 * lit_progress)), width=3)
                
                # Status pill indicator at top-right
                pill_x = nx + node_w - 40
                pill_y = ny + 24
                odraw.ellipse([(pill_x - 6, pill_y - 6), (pill_x + 6, pill_y + 6)], fill=(*r_col, 255))
                
                # Node text with bright color
                odraw.text((nx + 20, ny + 20), n["title"], font=font_node_title, fill=(255, 255, 255, 255))
                odraw.text((nx + 20, ny + 95), n["desc"], font=font_node_desc, fill=(*r_col, int(240 * lit_progress)))

        # Continuous data pulse loop once all nodes are lit (t > 7.0s)
        if t >= 7.0:
            cycle = (t - 7.0) % 1.5
            progress = cycle / 1.5
            pulse_x = int(start_x + total_w * progress)
            cv2.circle(frame_cv, (pulse_x, y_center), 8, (255, 255, 255), -1)
            cv2.circle(frame_cv, (pulse_x, y_center), 18, (168, 85, 247), 2)
            
            # Bottom banner
            b_alpha = min(1.0, (t - 7.0) / 0.6)
            foot_txt = "CRASH EVENT  ➔  LANGGRAPH ORCHESTRATION  ➔  TRIAGE COMPLETE IN < 60s"
            fb = font_footer.getbbox(foot_txt)
            fw = fb[2] - fb[0]
            fx = (width - fw) // 2
            fy = height - 140
            
            odraw.rounded_rectangle([(fx - 28, fy - 10), (fx + fw + 28, fy + 38)], radius=8, fill=(16, 22, 34, int(230 * b_alpha)), outline=(56, 189, 248, int(180 * b_alpha)), width=2)
            odraw.text((fx, fy), foot_txt, font=font_footer, fill=(224, 242, 254, int(255 * b_alpha)))

        # Composite PIL overlay
        img_rgba = Image.fromarray(cv2.cvtColor(frame_cv, cv2.COLOR_BGR2RGBA))
        img_rgba = Image.alpha_composite(img_rgba, overlay)
        frame_cv = cv2.cvtColor(np.array(img_rgba), cv2.COLOR_RGBA2BGR)

        proc.stdin.write(frame_cv.tobytes())

    proc.stdin.close()
    proc.wait()
    print(f"Flowchart MP4 successfully saved to {output_mp4}")
    
    # Generate companion GIF
    output_gif = "d:/Ichnoscope-WCC-30/docs/assets/flowchart-orchestrator-animation.gif"
    print("Encoding companion GIF...")
    subprocess.run([
        "ffmpeg", "-y",
        "-i", output_mp4,
        "-vf", "fps=18,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3",
        output_gif
    ], check=True)
    print(f"Flowchart GIF successfully saved to {output_gif}")

if __name__ == "__main__":
    render_flowchart()
