(function (global) {
  'use strict';

  var CFG = global.APP_CONFIG || {};
  var U = global.Utils;
  function tr(key, vars) { return global.I18n ? global.I18n.t(key, vars) : key; }
  var KEY_SUBJECTS = 'qr2w.subjects.v1';
  var KEY_UPLOADS = 'qr2w.uploads.v1';

  var Store = {
    mode: CFG.mode || 'local',
    configError: null
  };

  function readLocal(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  }

  function writeLocal(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (err) {
      throw new Error(tr('err.quota'));
    }
  }

  function nextId(subjects) {
    var max = 0;
    subjects.forEach(function (s) {
      var match = /^P(\d+)$/.exec(s.id || '');
      if (match) max = Math.max(max, parseInt(match[1], 10));
    });
    return 'P' + String(max + 1).padStart(3, '0');
  }

  function base() {
    return String(CFG.supabaseUrl).replace(/\/+$/, '');
  }

  function headers(extra) {
    var result = {
      apikey: CFG.supabaseAnonKey,
      Authorization: 'Bearer ' + CFG.supabaseAnonKey
    };
    if (extra) Object.keys(extra).forEach(function (key) { result[key] = extra[key]; });
    return result;
  }

  function api(path, options) {
    return fetch(base() + path, options).then(function (response) {
      if (!response.ok) {
        return response.text().then(function (text) {
          throw new Error(tr('err.cloudFail', { status: response.status, detail: String(text).slice(0, 180) }));
        });
      }
      if (response.status === 204) return null;
      return response.json();
    });
  }

  function mapSubject(row) {
    return { id: row.id, name: row.name, note: row.note || '', createdAt: row.created_at };
  }

  function mapUpload(row) {
    return {
      id: row.id,
      subjectId: row.subject_id,
      imageUrl: row.image_url,
      storagePath: row.storage_path || null,
      takenAt: row.taken_at || null,
      latitude: row.latitude == null ? null : Number(row.latitude),
      longitude: row.longitude == null ? null : Number(row.longitude),
      locationName: row.location_name || '',
      camera: row.camera || '',
      note: row.note || '',
      fileName: row.file_name || '',
      createdAt: row.created_at
    };
  }

  Store.init = function () {
    if (Store.mode === 'supabase' && (!CFG.supabaseUrl || !CFG.supabaseAnonKey)) {
      Store.configError = tr('err.configMissing');
      Store.mode = 'local';
    }
    return Store.mode;
  };

  Store.listSubjects = async function () {
    if (Store.mode === 'local') {
      return readLocal(KEY_SUBJECTS, []).sort(function (a, b) { return a.id.localeCompare(b.id); });
    }
    var rows = await api('/rest/v1/subjects?select=*&order=id.asc', {
      headers: headers({ Accept: 'application/json' })
    });
    return rows.map(mapSubject);
  };

  Store.createSubject = async function (name, note) {
    if (Store.mode === 'local') {
      var subjects = readLocal(KEY_SUBJECTS, []);
      var subject = {
        id: nextId(subjects),
        name: String(name || '').trim() || tr('common.unnamed'),
        note: String(note || '').trim(),
        createdAt: new Date().toISOString()
      };
      subjects.push(subject);
      writeLocal(KEY_SUBJECTS, subjects);
      return subject;
    }
    var existing = await Store.listSubjects();
    var payload = {
      id: nextId(existing),
      name: String(name || '').trim() || tr('common.unnamed'),
      note: String(note || '').trim()
    };
    var rows = await api('/rest/v1/subjects', {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(payload)
    });
    return mapSubject(rows[0]);
  };

  Store.deleteSubject = async function (pid) {
    if (Store.mode === 'local') {
      var subjects = readLocal(KEY_SUBJECTS, []).filter(function (s) { return s.id !== pid; });
      var uploads = readLocal(KEY_UPLOADS, {});
      delete uploads[pid];
      writeLocal(KEY_SUBJECTS, subjects);
      writeLocal(KEY_UPLOADS, uploads);
      return;
    }
    var uploads = await Store.listUploads(pid);
    for (var i = 0; i < uploads.length; i++) {
      if (uploads[i].storagePath) {
        try { await removeObject(uploads[i].storagePath); } catch (err) { console.warn(err); }
      }
    }
    await api('/rest/v1/uploads?subject_id=eq.' + encodeURIComponent(pid), {
      method: 'DELETE', headers: headers()
    });
    await api('/rest/v1/subjects?id=eq.' + encodeURIComponent(pid), {
      method: 'DELETE', headers: headers()
    });
  };

  Store.listUploads = async function (pid) {
    if (Store.mode === 'local') {
      var all = readLocal(KEY_UPLOADS, {});
      return (all[pid] || []).slice().sort(function (a, b) {
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
    }
    var rows = await api(
      '/rest/v1/uploads?subject_id=eq.' + encodeURIComponent(pid) +
      '&select=*&order=created_at.desc',
      { headers: headers({ Accept: 'application/json' }) }
    );
    return rows.map(mapUpload);
  };

  Store.addUpload = async function (item) {
    if (Store.mode === 'local') {
      var dataUrl = await U.blobToDataUrl(item.blob);
      var all = readLocal(KEY_UPLOADS, {});
      if (!all[item.subjectId]) all[item.subjectId] = [];
      all[item.subjectId].unshift({
        id: U.uid(),
        subjectId: item.subjectId,
        imageUrl: dataUrl,
        storagePath: null,
        takenAt: item.takenAt || null,
        latitude: item.latitude == null ? null : item.latitude,
        longitude: item.longitude == null ? null : item.longitude,
        locationName: item.locationName || '',
        camera: item.camera || '',
        note: item.note || '',
        fileName: item.fileName || '',
        createdAt: new Date().toISOString()
      });
      writeLocal(KEY_UPLOADS, all);
      return true;
    }

    var path = item.subjectId + '/' + U.uid() + '.jpg';
    var uploadResponse = await fetch(
      base() + '/storage/v1/object/' + CFG.storageBucket + '/' + path,
      {
        method: 'POST',
        headers: headers({ 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }),
        body: item.blob
      }
    );
    if (!uploadResponse.ok) {
      var detail = await uploadResponse.text();
      throw new Error(tr('err.storageFail', { status: uploadResponse.status, detail: detail.slice(0, 160) }));
    }
    var imageUrl = base() + '/storage/v1/object/public/' + CFG.storageBucket + '/' + path;
    await api('/rest/v1/uploads', {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify({
        subject_id: item.subjectId,
        image_url: imageUrl,
        storage_path: path,
        taken_at: item.takenAt || null,
        latitude: item.latitude == null ? null : item.latitude,
        longitude: item.longitude == null ? null : item.longitude,
        location_name: item.locationName || '',
        camera: item.camera || '',
        note: item.note || '',
        file_name: item.fileName || ''
      })
    });
    return true;
  };

  function removeObject(path) {
    return fetch(
      base() + '/storage/v1/object/' + CFG.storageBucket + '/' + path,
      { method: 'DELETE', headers: headers() }
    );
  }

  Store.deleteUpload = async function (pid, id) {
    if (Store.mode === 'local') {
      var all = readLocal(KEY_UPLOADS, {});
      all[pid] = (all[pid] || []).filter(function (u) { return u.id !== id; });
      writeLocal(KEY_UPLOADS, all);
      return;
    }
    var rows = await api('/rest/v1/uploads?id=eq.' + encodeURIComponent(id) + '&select=storage_path', {
      headers: headers({ Accept: 'application/json' })
    });
    if (rows.length && rows[0].storage_path) {
      try { await removeObject(rows[0].storage_path); } catch (err) { console.warn(err); }
    }
    await api('/rest/v1/uploads?id=eq.' + encodeURIComponent(id), {
      method: 'DELETE', headers: headers()
    });
  };

  global.Store = Store;
})(window);
