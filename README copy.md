# 🌊 แผนที่ประเมินระดับน้ำท่วม เขตทุ่งครุ

ผู้ใช้ถ่ายรูปน้ำท่วมแล้วปักหมุดบนแผนที่ โมเดล YOLOv8-cls ประเมินระดับน้ำเป็น score 0.0–1.0
แล้วแผนที่แสดงผลเป็น **Hex grid** (บอกว่าแต่ละบริเวณท่วมแค่ไหน), **Heatmap** และ **จุดรายงาน**

| ส่วน | เทคโนโลยี |
|---|---|
| ML | YOLOv8-cls (ultralytics) เทรนในเครื่อง แล้ว export เป็น ONNX |
| Backend | FastAPI + onnxruntime + SQLAlchemy/Alembic + h3 |
| Database | PostgreSQL (ในเครื่อง / Supabase) |
| รูปภาพ | โฟลเดอร์ `uploads/` (ในเครื่อง) / Supabase Storage |
| Frontend | HTML + JS (ES modules) + Leaflet + leaflet.heat ไม่ต้อง build |
| Deploy | Render (Docker) + Supabase |

```
├── ml/                 เทรน / ทดสอบ / export โมเดล (ใช้ในเครื่องเท่านั้น)
├── backend/
│   ├── app/            FastAPI (main, config, db, models, inference, storage, geo)
│   ├── migrations/     Alembic
│   ├── models/         flood_cls.onnx + flood_cls.json  ← วางโมเดลที่นี่
│   └── scripts/        seed_demo.py (ข้อมูลตัวอย่าง)
├── frontend/           index.html, js/, css/, data/tungkhru.geojson
├── Dockerfile, render.yaml, .env.example
```

> ถ้ายังไม่มีไฟล์ `backend/models/flood_cls.onnx` ระบบจะใช้ **โมเดล dummy** ที่ให้ผลแบบสุ่ม
> หน้าเว็บจะแสดงป้าย "โมเดลทดสอบ" ไว้ ใช้ทดสอบระบบได้ แต่ผลที่ได้ยังไม่ใช่ของจริง

---

## 1. รันในเครื่อง (Quick start)

**สิ่งที่ต้องมี:** Python 3.12, PostgreSQL (และรหัสผ่านของ user `postgres`), Git

ทุกคำสั่งรันที่ **โฟลเดอร์หลักของโปรเจกต์** (โฟลเดอร์ที่มีไฟล์ README.md นี้)

### ขั้นที่ 1: ติดตั้ง (ทำครั้งเดียว)

```powershell
git clone https://github.com/MrBeam67/Flood-forecasting-using-Traffy-and-ML.git
cd Flood-forecasting-using-Traffy-and-ML

python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
```

> ถ้า PowerShell ขึ้นข้อความว่า *running scripts is disabled* ให้รันคำสั่งนี้ก่อน 1 ครั้ง
> `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`
> ถ้าใช้ cmd ให้รัน `.venv\Scripts\activate.bat` / ถ้าใช้ Git Bash, macOS หรือ Linux ให้รัน `source .venv/Scripts/activate` (macOS/Linux ใช้ `.venv/bin/activate`)
>
> ถ้า activate สำเร็จ ข้างหน้าบรรทัดคำสั่งจะมีคำว่า `(.venv)`

### ขั้นที่ 2: สร้างฐานข้อมูลและไฟล์ `.env` (ทำครั้งเดียว)

1. เปิด **pgAdmin** แล้วคลิกขวาที่ Databases → Create → Database ตั้งชื่อว่า `flood_tungkhru`
   (หรือใช้คำสั่ง `"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE flood_tungkhru;"`)
2. Copy ไฟล์ตั้งค่า:
   ```powershell
   copy .env.example .env
   ```
3. เปิดไฟล์ `.env` แล้วแก้ `YOUR_PASSWORD` เป็นรหัสผ่าน postgres ของคุณ
   ```
   DATABASE_URL=postgresql://postgres:รหัสผ่าน@localhost:5432/flood_tungkhru
   ```
   ถ้ารหัสผ่านมีอักขระพิเศษ เช่น `@ # / :` ต้องเขียนแบบ URL-encode เช่น `@` → `%40`
4. ถ้าจะทดสอบโดยปักหมุดนอกเขตทุ่งครุ ให้ตั้ง `ENFORCE_BOUNDARY=false`

### ขั้นที่ 3: สร้างตาราง (ทำครั้งแรก และทุกครั้งที่ pull โค้ดที่มี migration ใหม่)

```powershell
alembic -c backend/alembic.ini upgrade head
```

ถ้าขึ้นข้อความว่า `Running upgrade -> 0001, create reports table` แปลว่าสำเร็จ

### ขั้นที่ 4: ใส่ข้อมูลตัวอย่าง (ไม่ทำก็ได้)

```powershell
python -m backend.scripts.seed_demo --n 120     # สุ่มรายงานปลอม 120 จุดในเขตทุ่งครุ
python -m backend.scripts.seed_demo --clear     # ลบข้อมูลตัวอย่างออก
```

### ขั้นที่ 5: รัน server

```powershell
uvicorn backend.app.main:app --reload
```

- หน้าเว็บ: http://localhost:8000
- เอกสาร API (ทดลองยิง API ได้): http://localhost:8000/docs
- กด `Ctrl + C` เพื่อหยุด server

ครั้งต่อไปทำแค่ 2 คำสั่ง: `.venv\Scripts\Activate.ps1` แล้วตามด้วย `uvicorn backend.app.main:app --reload`

### ปัญหาที่เจอบ่อย

| อาการ | วิธีแก้ |
|---|---|
| `password authentication failed` | รหัสผ่านใน `.env` ผิด |
| `database "flood_tungkhru" does not exist` | ยังไม่ได้ทำขั้นที่ 2 ข้อ 1 |
| `relation "reports" does not exist` | ยังไม่ได้รันขั้นที่ 3 |
| `ModuleNotFoundError: backend` | ไม่ได้รันคำสั่งจากโฟลเดอร์หลักของโปรเจกต์ |
| `'uvicorn' is not recognized` | ยังไม่ได้ activate `.venv` |
| ป้ายบนเว็บขึ้นว่า "โมเดลทดสอบ" | ปกติ ยังไม่มีไฟล์ `backend/models/flood_cls.onnx` (ดูหัวข้อ 3) |
| ส่งรายงานแล้วขึ้น "พิกัดอยู่นอกเขตทุ่งครุ" | ปักหมุดในกรอบสีน้ำเงิน หรือตั้ง `ENFORCE_BOUNDARY=false` |

## 2. API

| Method | Path | คำอธิบาย |
|---|---|---|
| POST | `/api/reports` | multipart: `image`, `lat`, `lng` → ทำนายผลแล้วบันทึก ส่งกลับ `{level, label, score, probs, ...}` |
| GET | `/api/heatmap?hours=24` | `[[lat, lng, intensity], ...]` (intensity = score × ค่าลดลงตามเวลา) |
| GET | `/api/hexgrid?hours=24` | GeoJSON ช่อง H3 res 9 พร้อม `severity`, `confidence`, `count`, `latest` |
| GET | `/api/area?lat=&lng=&hours=24` | สรุป "บริเวณของฉัน" (ช่อง hex ที่พิกัดนั้นอยู่) |
| GET | `/api/reports?hours=24` | รายการรายงานล่าสุด (สูงสุด 500 รายการ) |
| GET | `/api/health` | health check |

**Severity score** = ค่าคาดหวังจากความน่าจะเป็นของแต่ละคลาส:
`score = 0·P(dry) + 0.33·P(low) + 0.67·P(medium) + 1.0·P(high)`

**ลดน้ำหนักตามเวลา**: `weight = exp(-อายุรายงาน(ชม.) / DECAY_HOURS)` (ค่าเริ่มต้นคือ 6 ชม.) รายงานเก่าจะค่อยๆ จางลง
- ค่า `severity` ของ Hex = ค่าเฉลี่ยของ score ถ่วงน้ำหนักด้วย weight
- ความทึบของสี (opacity) ขึ้นกับผลรวมของ weight ยิ่งมีรายงานใหม่มากยิ่งทึบ
- Heatmap จะรวมจุดที่อยู่ใกล้กันในรัศมีประมาณ 25 ม. แล้วใช้ค่า max เพื่อไม่ให้ที่ที่มีคนแจ้งเยอะสีแดงเกินจริง

## 3. โมเดล AI

### 3.1 โครงสร้าง Dataset

```
ml/raw/                  ← วางรูปที่ติด label แล้ว แยกโฟลเดอร์ตามระดับ
  0_dry/      ถนนแห้ง / ไม่มีน้ำขัง
  1_low/      น้ำขังต่ำกว่าข้อเท้า, ขอบฟุตบาทยังเห็น
  2_medium/   ระดับครึ่งน่อง–เข่า, ท่วมถึงครึ่งล้อรถ
  3_high/     เกินเข่า, รถเล็กผ่านไม่ได้
```

- ชื่อโฟลเดอร์ **ต้องขึ้นต้นด้วยตัวเลขระดับ** เพราะ backend ใช้ตัวเลขนี้คำนวณ score
- ควรมีคลาสละอย่างน้อย 200–300 รูป และจำนวนแต่ละคลาสไม่ควรต่างกันมาก
- ใช้รูปจากทั่วกรุงเทพฯ ได้ (รวมถึง Traffy) ยิ่งมุมกล้อง สภาพแสง และกลางวัน/กลางคืนหลากหลาย ยิ่งดี

```bash
python ml/split_dataset.py --src ml/raw --dst ml/dataset --val 0.2
```

จะได้โฟลเดอร์ `ml/dataset/train/<class>/` และ `ml/dataset/val/<class>/` ตามรูปแบบที่ YOLO classification ใช้

### 3.2 เทรน

```bash
# ถ้ามีการ์ดจอ NVIDIA ให้ติดตั้ง PyTorch รุ่น CUDA ก่อน (ดูคำสั่งได้ที่ pytorch.org)
pip install -r ml/requirements.txt
python ml/train.py --model yolov8n-cls.pt --epochs 50
python ml/predict.py some_test_image.jpg
```

ถ้าใช้ CPU อย่างเดียว ให้ใช้ `yolov8n-cls.pt` และ `--imgsz 224` (ใช้เวลาหลายชั่วโมง) ถ้ามี GPU ลอง `yolov8s-cls.pt` ได้

### 3.3 Export ไปให้ backend ใช้

```bash
python ml/export_onnx.py                          # จาก ml/runs/flood_cls/weights/best.pt
python ml/export_onnx.py --weights downloaded.pt  # หรือใช้โมเดล classification ที่โหลดมา
```

ได้ไฟล์ `backend/models/flood_cls.onnx` + `flood_cls.json` แล้ว restart server ป้ายบนหน้าเว็บจะเปลี่ยนจาก "โมเดลทดสอบ" เป็นชื่อเวอร์ชันของโมเดล

> ใช้โมเดล 2 คลาสได้ด้วย (`0_dry`, `1_flood`) ในกรณีนี้ score จะเท่ากับความน่าจะเป็นที่ท่วม

## 4. Deploy (Render + Supabase)

1. **Supabase**: สร้างโปรเจกต์ใหม่
   - Storage → New bucket `flood-images` ตั้งเป็น **Public**
   - Project Settings → API: คัดลอก `Project URL` และ `service_role` key
   - Connect → **Session pooler** URI (Render รองรับแค่ IPv4 ต้องใช้ pooler ห้ามใช้ direct connection)
2. Commit ไฟล์ `backend/models/flood_cls.onnx` (ถ้ามีแล้ว) แล้ว push ขึ้น GitHub
3. **Render**: New → Blueprint → เลือก repo นี้ ระบบจะอ่าน `render.yaml` ให้เอง
   จากนั้นกรอก `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
4. ทุกครั้งที่ deploy ระบบจะรัน `alembic upgrade head` ให้อัตโนมัติ

ข้อควรรู้
- แพ็กเกจ free ของ Render จะหลับเมื่อไม่มีคนใช้ (เปิดครั้งแรกช้าเกือบ 1 นาที) ช่วงที่ต้องนำเสนอให้เปลี่ยนเป็น Starter ชั่วคราว
- ปุ่ม 📍 ใช้ได้เฉพาะเมื่อเปิดผ่าน https หรือ localhost
- ทุกรูปจะถูก re-encode ใหม่ ซึ่งลบ EXIF (รวมถึงพิกัด GPS ของมือถือ) ออก และย่อขนาดให้ไม่เกิน 1280 px

## เครดิตข้อมูล

- ขอบเขตเขตและแขวง: © OpenStreetMap contributors (ODbL)
- แผนที่พื้นหลัง: OpenStreetMap
