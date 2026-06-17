from flask import Flask, jsonify, request, send_from_directory
import psycopg2
import psycopg2.extras
import os
from contextlib import contextmanager

app = Flask(__name__, static_folder='static')
DATABASE_URL = os.environ['DATABASE_URL']


@contextmanager
def get_db():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute('''
                CREATE TABLE IF NOT EXISTS months (
                    id     SERIAL PRIMARY KEY,
                    year   INTEGER NOT NULL,
                    month  INTEGER NOT NULL,
                    half   INTEGER NOT NULL DEFAULT 1,
                    income REAL DEFAULT 0,
                    saved  REAL DEFAULT 0,
                    UNIQUE(year, month, half)
                )
            ''')
            cur.execute('''
                CREATE TABLE IF NOT EXISTS entries (
                    id        SERIAL PRIMARY KEY,
                    month_id  INTEGER NOT NULL REFERENCES months(id) ON DELETE CASCADE,
                    type      TEXT NOT NULL,
                    category  TEXT NOT NULL,
                    name      TEXT NOT NULL,
                    planned   REAL DEFAULT 0,
                    actual    REAL DEFAULT 0
                )
            ''')


init_db()


@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/api/months', methods=['GET'])
def list_months():
    with get_db() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute('SELECT * FROM months ORDER BY year DESC, month DESC, half DESC')
            rows = cur.fetchall()
    return jsonify([dict(r) for r in rows])


@app.route('/api/months', methods=['POST'])
def create_month():
    data = request.get_json()
    year = data['year']
    month = data['month']
    half = data.get('half', 1)
    copy_from = data.get('copy_from_id')
    try:
        with get_db() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    'INSERT INTO months (year, month, half, income, saved) VALUES (%s,%s,%s,0,0) RETURNING *',
                    (year, month, half)
                )
                new_month = dict(cur.fetchone())
                new_id = new_month['id']
                if copy_from:
                    cur.execute(
                        'SELECT type, category, name, planned FROM entries WHERE month_id=%s',
                        (copy_from,)
                    )
                    entries = cur.fetchall()
                    for e in entries:
                        cur.execute(
                            'INSERT INTO entries (month_id, type, category, name, planned, actual)'
                            ' VALUES (%s,%s,%s,%s,%s,0)',
                            (new_id, e['type'], e['category'], e['name'], e['planned'])
                        )
        return jsonify(new_month), 201
    except psycopg2.errors.UniqueViolation:
        return jsonify({'error': 'exists'}), 409


@app.route('/api/months/<int:mid>', methods=['GET'])
def get_month(mid):
    with get_db() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute('SELECT * FROM months WHERE id=%s', (mid,))
            month = cur.fetchone()
            if not month:
                return jsonify({'error': 'not found'}), 404
            cur.execute(
                'SELECT * FROM entries WHERE month_id=%s ORDER BY type, category, id',
                (mid,)
            )
            entries = cur.fetchall()
    return jsonify({'month': dict(month), 'entries': [dict(e) for e in entries]})


@app.route('/api/months/<int:mid>', methods=['PUT'])
def update_month(mid):
    data = request.get_json()
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE months SET income=%s, saved=%s WHERE id=%s',
                (data.get('income', 0), data.get('saved', 0), mid)
            )
    return jsonify({'ok': True})


@app.route('/api/months/<int:mid>', methods=['DELETE'])
def delete_month(mid):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute('DELETE FROM months WHERE id=%s', (mid,))
    return jsonify({'ok': True})


@app.route('/api/entries', methods=['POST'])
def create_entry():
    data = request.get_json()
    with get_db() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                'INSERT INTO entries (month_id, type, category, name, planned, actual)'
                ' VALUES (%s,%s,%s,%s,%s,%s) RETURNING *',
                (data['month_id'], data['type'], data['category'], data['name'],
                 data.get('planned', 0), data.get('actual', 0))
            )
            row = cur.fetchone()
    return jsonify(dict(row)), 201


@app.route('/api/entries/<int:eid>', methods=['PUT'])
def update_entry(eid):
    data = request.get_json()
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE entries SET category=%s, name=%s, planned=%s, actual=%s WHERE id=%s',
                (data['category'], data['name'],
                 data.get('planned', 0), data.get('actual', 0), eid)
            )
    return jsonify({'ok': True})


@app.route('/api/entries/<int:eid>', methods=['DELETE'])
def delete_entry(eid):
    with get_db() as conn:
        with conn.cursor() as cur:
            cur.execute('DELETE FROM entries WHERE id=%s', (eid,))
    return jsonify({'ok': True})


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8000)), debug=False)
