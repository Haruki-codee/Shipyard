import os
from datetime import datetime, date
from flask import Flask, request, jsonify, abort
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.config.update(
    SQLALCHEMY_DATABASE_URI=os.getenv("DATABASE_URL", "sqlite:///kanban.db"),
    JWT_SECRET_KEY=os.getenv("JWT_SECRET", "dev-only-secret-change-me-in-production"),
)
CORS(app)
db = SQLAlchemy(app)
JWTManager(app)


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False)
    name = db.Column(db.String(120), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)


class Board(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    owner_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)


class Column(db.Model):
    __tablename__ = "board_column"
    id = db.Column(db.Integer, primary_key=True)
    board_id = db.Column(db.Integer, db.ForeignKey("board.id"), nullable=False)
    title = db.Column(db.String(120), nullable=False)
    position = db.Column(db.Integer, default=0, nullable=False)


class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    column_id = db.Column(db.Integer, db.ForeignKey("board_column.id"), nullable=False)
    title = db.Column(db.String(255), nullable=False)
    description = db.Column(db.Text, default="")  # markdown
    assignee_id = db.Column(db.Integer, db.ForeignKey("user.id"))
    priority = db.Column(db.String(10), default="medium", nullable=False)
    due_date = db.Column(db.Date)
    labels = db.Column(db.String(255), default="")  # comma-separated
    position = db.Column(db.Integer, default=0, nullable=False)


class AuditLog(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    board_id = db.Column(db.Integer, db.ForeignKey("board.id"), nullable=False)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    action = db.Column(db.String(60), nullable=False)
    detail = db.Column(db.Text, default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class BoardMember(db.Model):
    board_id = db.Column(db.Integer, db.ForeignKey("board.id"), primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), primary_key=True)
    role = db.Column(db.String(10), nullable=False)  # owner / editor / viewer

RANK = {"viewer": 0, "editor": 1, "owner": 2}

def uid(): return int(get_jwt_identity())
def need(bid, minrole="viewer"):
    m = db.session.get(BoardMember, (bid, uid()))
    if not m or RANK[m.role] < RANK[minrole]: abort(403)
    return m.role
def board_of(col_id): return db.get_or_404(Column, col_id).board_id
def log(board_id, action, detail=""):
    db.session.add(AuditLog(board_id=board_id, user_id=uid(), action=action, detail=detail))

def task_json(t): return dict(id=t.id, columnId=t.column_id, title=t.title, description=t.description or "", assigneeId=t.assignee_id,
                              priority=t.priority, dueDate=t.due_date.isoformat() if t.due_date else None, labels=t.labels or "")


@app.post("/api/auth/register")
def register():
    d = request.json
    if User.query.filter_by(email=d["email"].lower()).first():
        return jsonify(error="Email already registered"), 409
    u = User(email=d["email"].lower(), name=d["name"], password_hash=generate_password_hash(d["password"]))
    db.session.add(u); db.session.commit()
    return jsonify(token=create_access_token(identity=str(u.id)), user=dict(id=u.id, name=u.name))


@app.post("/api/auth/login")
def login():
    d = request.json
    u = User.query.filter_by(email=d["email"].lower()).first()
    if not u or not check_password_hash(u.password_hash, d["password"]):
        return jsonify(error="Wrong email or password"), 401
    return jsonify(token=create_access_token(identity=str(u.id)), user=dict(id=u.id, name=u.name))


@app.get("/api/users")
@jwt_required()
def users():
    return jsonify([dict(id=u.id, name=u.name) for u in User.query.order_by(User.name)])


@app.get("/api/boards")
@jwt_required()
def boards():
    ids = [m.board_id for m in BoardMember.query.filter_by(user_id=uid())]
    return jsonify([dict(id=b.id, name=b.name) for b in Board.query.filter(Board.id.in_(ids)).order_by(Board.id)])


@app.post("/api/boards")
@jwt_required()
def create_board():
    b = Board(name=request.json["name"], owner_id=uid())
    db.session.add(b); db.session.flush()
    for i, t in enumerate(["Backlog", "In progress", "In review", "Deployed"]):
        db.session.add(Column(board_id=b.id, title=t, position=i))
    db.session.add(BoardMember(board_id=b.id, user_id=uid(), role="owner"))
    log(b.id, "board.create", b.name); db.session.commit()
    return jsonify(id=b.id, name=b.name), 201


@app.get("/api/boards/<int:bid>")
@jwt_required()
def get_board(bid):
    b = db.get_or_404(Board, bid); role = need(bid)
    cols = Column.query.filter_by(board_id=bid).order_by(Column.position).all()
    out = []
    for c in cols:
        ts = Task.query.filter_by(column_id=c.id).order_by(Task.position).all()
        out.append(dict(id=c.id, title=c.title, tasks=[task_json(t) for t in ts]))
    logs = AuditLog.query.filter_by(board_id=bid).order_by(AuditLog.id.desc()).limit(30).all()
    names = {u.id: u.name for u in User.query.all()}
    return jsonify(id=b.id, name=b.name, role=role, columns=out, audit=[
        dict(id=l.id, user=names.get(l.user_id), action=l.action, detail=l.detail, at=l.created_at.isoformat()) for l in logs])


@app.post("/api/columns/<int:cid>/tasks")
@jwt_required()
def create_task(cid):
    need(board_of(cid), "editor")
    n = Task.query.filter_by(column_id=cid).count()
    t = Task(column_id=cid, title=request.json["title"], position=n)
    db.session.add(t); log(board_of(cid), "task.create", t.title); db.session.commit()
    return jsonify(task_json(t)), 201


@app.patch("/api/tasks/<int:tid>")
@jwt_required()
def update_task(tid):
    t = db.get_or_404(Task, tid); d = request.json
    need(board_of(t.column_id), "editor")
    for k, f in (("title", "title"), ("description", "description"), ("assigneeId", "assignee_id"), ("priority", "priority"), ("labels", "labels")):
        if k in d: setattr(t, f, d[k])
    if "dueDate" in d: t.due_date = date.fromisoformat(d["dueDate"]) if d["dueDate"] else None
    log(board_of(t.column_id), "task.update", t.title); db.session.commit()
    return jsonify(task_json(t))


@app.delete("/api/tasks/<int:tid>")
@jwt_required()
def delete_task(tid):
    t = db.get_or_404(Task, tid); bid = board_of(t.column_id); need(bid, "editor")
    log(bid, "task.delete", t.title); db.session.delete(t); db.session.commit()
    return "", 204


@app.post("/api/tasks/<int:tid>/move")
@jwt_required()
def move_task(tid):
    d = request.json
    t = db.get_or_404(Task, tid); src = db.get_or_404(Column, t.column_id); dst = db.get_or_404(Column, d["columnId"])
    need(src.board_id, "editor")
    if dst.board_id != src.board_id: abort(400)
    ordered = lambda cid: Task.query.filter_by(column_id=cid).order_by(Task.position).all()
    s = [x for x in ordered(src.id) if x.id != tid]
    dl = s if src.id == dst.id else ordered(dst.id)
    dl.insert(max(0, min(d["index"], len(dl))), t)
    t.column_id = dst.id
    for lst in (s, dl):
        for i, x in enumerate(lst): x.position = i
    if src.id != dst.id:
        log(src.board_id, "task.move", f'"{t.title}": {src.title} → {dst.title}')
    else:
        log(src.board_id, "task.reorder", f'"{t.title}" in {src.title}')
    db.session.commit()
    return jsonify(ok=True)


@app.post("/api/boards/<int:bid>/members")
@jwt_required()
def add_member(bid):
    need(bid, "owner"); d = request.json
    u = User.query.filter_by(email=d["email"].lower()).first()
    if not u: return jsonify(error="No user with that email"), 404
    m = db.session.get(BoardMember, (bid, u.id)) or BoardMember(board_id=bid, user_id=u.id)
    m.role = d.get("role", "editor"); db.session.add(m)
    log(bid, "member.add", f"{u.name} as {m.role}"); db.session.commit()
    return jsonify(ok=True)


@app.get("/api/boards/<int:bid>/analytics")
@jwt_required()
def analytics(bid):
    need(bid)
    cols = Column.query.filter_by(board_id=bid).order_by(Column.position).all()
    per = [dict(title=c.title, count=Task.query.filter_by(column_id=c.id).count()) for c in cols]
    overdue = (Task.query.join(Column, Task.column_id == Column.id)
               .filter(Column.board_id == bid, Task.due_date < date.today(), Column.id != cols[-1].id).count())
    weeks = {}
    for l in AuditLog.query.filter_by(board_id=bid, action="task.move"):
        if l.detail.endswith("→ " + cols[-1].title):
            k = l.created_at.strftime("%G-W%V"); weeks[k] = weeks.get(k, 0) + 1
    return jsonify(perColumn=per, overdue=overdue, deployedPerWeek=[dict(week=k, count=v) for k, v in sorted(weeks.items())])


with app.app_context():
    db.create_all()

if __name__ == "__main__":
    app.run(debug=True, port=5000)
