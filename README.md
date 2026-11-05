# Shipyard: Dev/Ops Kanban

1. `docker compose up -d`  (PostgreSQL)
2. `cd backend && pip install -r requirements.txt && JWT_SECRET=<long-random> python app.py`
3. `cd frontend && npm install && npm run dev`  → http://localhost:5173

Register an account; a default board (Backlog / In progress / In review / Deployed) is created on first sign-in.
Every create, edit, delete and move is recorded in the `audit_log` table and shown in the Activity panel.
Roles: owner, editor, viewer. Invite registered users by email. Delete old DB (kanban.db or `docker compose down -v`) after upgrading, since tables changed.
