"use strict";
(function () {
  function api(method, path, body) {
    var init = { method: method, credentials: "same-origin", headers: {} };
    if (method !== "GET") init.headers["Content-Type"] = "application/json";
    if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(path, init).then(function (res) {
      if (res.status === 204) return null;
      return res.text().then(function (text) {
        var data = null;
        if (text) { try { data = JSON.parse(text); } catch (err) { data = null; } }
        if (!res.ok) {
          var msg = data && data.error ? data.error : "Request failed with status " + res.status;
          throw new Error(msg);
        }
        return data;
      });
    });
  }

  function fail(err) {
    window.alert(err && err.message ? err.message : String(err));
  }

  function reload() {
    window.location.reload();
  }

  function copyText(value) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).catch(fail);
      return;
    }
    var input = document.createElement("textarea");
    input.value = value;
    document.body.appendChild(input);
    input.select();
    try { document.execCommand("copy"); } catch (err) { fail(err); }
    document.body.removeChild(input);
  }

  function propsOf(el) {
    var raw = el.getAttribute("data-props");
    if (!raw) return {};
    try { return JSON.parse(raw) || {}; } catch (err) { return {}; }
  }

  function closest(event, selector) {
    var target = event.target;
    if (!target || !target.closest) return null;
    return target.closest(selector);
  }

  function flash(el, text) {
    var label = el.textContent;
    el.textContent = text;
    window.setTimeout(function () { el.textContent = label; }, 1200);
  }

  function field(form, name) {
    var el = form.querySelector("[name=" + name + "]");
    return el && typeof el.value === "string" ? el.value : "";
  }

  var islands = {
    copy: function (root, props) {
      root.addEventListener("click", function (event) {
        event.preventDefault();
        copyText(String(props.text || ""));
        flash(root, "Copied");
      });
    },
    delete: function (root, props) {
      root.addEventListener("click", function (event) {
        event.preventDefault();
        if (!window.confirm("Delete this artifact, all versions and all shares?")) return;
        api("DELETE", "/api/artifacts/" + encodeURIComponent(props.slug)).then(function () {
          window.location.assign("/");
        }, fail);
      });
    },
    versions: function (root, props) {
      root.addEventListener("click", function (event) {
        var el = closest(event, "[data-action]");
        if (!el || !root.contains(el)) return;
        var action = el.getAttribute("data-action");
        if (action !== "pin" && action !== "set-live" && action !== "newest") return;
        event.preventDefault();
        if (action === "newest") {
          api("PATCH", "/api/artifacts/" + encodeURIComponent(props.slug), { pinned: null }).then(reload, fail);
        } else {
          api("PATCH", "/api/artifacts/" + encodeURIComponent(props.slug), {
            pinned: Number(el.getAttribute("data-n"))
          }).then(reload, fail);
        }
      });
    },
    share: function (root, props) {
      root.addEventListener("click", function (event) {
        var removed = closest(event, "[data-action=remove-share]");
        if (removed && root.contains(removed)) {
          event.preventDefault();
          api(
            "DELETE",
            "/api/artifacts/" + encodeURIComponent(props.slug) + "/shares/" + encodeURIComponent(removed.getAttribute("data-email"))
          ).then(reload, fail);
          return;
        }
        var tag = closest(event, "[data-action=remove-tag]");
        if (tag && root.contains(tag)) {
          event.preventDefault();
          var tags = Array.isArray(props.tags) ? props.tags.filter(function (value) {
            return value !== tag.getAttribute("data-tag");
          }) : [];
          api("PATCH", "/api/artifacts/" + encodeURIComponent(props.slug), { tags: tags }).then(reload, fail);
        }
      });
      root.addEventListener("submit", function (event) {
        var form = event.target;
        var kind = form.getAttribute("data-form");
        if (!kind) return;
        event.preventDefault();
        if (kind === "mode") {
          var checked = form.querySelector("[name=mode]:checked") || form.querySelector("[name=mode]");
          api("PATCH", "/api/artifacts/" + encodeURIComponent(props.slug), {
            mode: checked ? checked.value : "private"
          }).then(reload, fail);
        } else if (kind === "title") {
          api("PATCH", "/api/artifacts/" + encodeURIComponent(props.slug), {
            title: field(form, "title").trim()
          }).then(reload, fail);
        } else if (kind === "share") {
          var email = field(form, "email").trim();
          if (email === "") return;
          api(
            "PUT",
            "/api/artifacts/" + encodeURIComponent(props.slug) + "/shares/" + encodeURIComponent(email),
            { role: field(form, "role") }
          ).then(reload, fail);
        } else if (kind === "tags") {
          var tagInput = field(form, "tag").trim().toLowerCase();
          if (tagInput === "") return;
          var next = Array.isArray(props.tags) ? props.tags.slice() : [];
          if (next.indexOf(tagInput) === -1) next.push(tagInput);
          api("PATCH", "/api/artifacts/" + encodeURIComponent(props.slug), { tags: next }).then(reload, fail);
        } else if (kind === "project") {
          var project = field(form, "project");
          api("PATCH", "/api/artifacts/" + encodeURIComponent(props.slug), {
            project: project === "" ? null : project
          }).then(reload, fail);
        }
      });
    },
    project: function (root, props) {
      root.addEventListener("click", function (event) {
        var el = closest(event, "[data-action=remove-member]");
        if (!el || !root.contains(el)) return;
        event.preventDefault();
        api(
          "DELETE",
          "/api/projects/" + encodeURIComponent(props.slug) + "/members/" + encodeURIComponent(el.getAttribute("data-email"))
        ).then(reload, fail);
      });
      root.addEventListener("submit", function (event) {
        var form = event.target;
        var kind = form.getAttribute("data-form");
        if (!kind) return;
        event.preventDefault();
        if (kind === "project-new") {
          var slug = field(form, "slug").trim().toLowerCase();
          if (slug === "") return;
          var body = { slug: slug };
          var title = field(form, "title").trim();
          var description = field(form, "description").trim();
          if (title !== "") body.title = title;
          if (description !== "") body.description = description;
          api("POST", "/api/projects", body).then(function (data) {
            window.location.assign("/p/" + encodeURIComponent(data.slug));
          }, fail);
        } else if (kind === "description") {
          api("PATCH", "/api/projects/" + encodeURIComponent(props.slug), {
            description: field(form, "description").trim()
          }).then(reload, fail);
        } else if (kind === "add-artifact") {
          var artifact = field(form, "artifact");
          if (artifact === "") return;
          api("PATCH", "/api/artifacts/" + encodeURIComponent(artifact), { project: props.slug }).then(reload, fail);
        } else if (kind === "member") {
          var email = field(form, "email").trim();
          if (email === "") return;
          api(
            "PUT",
            "/api/projects/" + encodeURIComponent(props.slug) + "/members/" + encodeURIComponent(email),
            { role: field(form, "role") }
          ).then(reload, fail);
        }
      });
    },
    tokens: function (root) {
      root.addEventListener("click", function (event) {
        var copy = closest(event, "[data-action=copy]");
        if (copy && root.contains(copy)) {
          event.preventDefault();
          copyText(copy.getAttribute("data-copy") || "");
          flash(copy, "Copied");
          return;
        }
        var revoke = closest(event, "[data-action=revoke], [data-action=revoke-token]");
        if (!revoke || !root.contains(revoke)) return;
        event.preventDefault();
        if (!window.confirm("Revoke this token? The CLI using it will stop working.")) return;
        api("DELETE", "/api/tokens/" + encodeURIComponent(revoke.getAttribute("data-id"))).then(function () {
          var row = revoke.closest("tr");
          if (row) row.remove();
        }, fail);
      });
      root.addEventListener("submit", function (event) {
        var form = event.target;
        if (form.getAttribute("data-form") !== "token") return;
        event.preventDefault();
        var name = field(form, "name").trim();
        var scope = field(form, "scope");
        api("POST", "/api/tokens", { name: name, scope: scope }).then(function (data) {
          var box = document.getElementById("token-box");
          var code = document.getElementById("token-value");
          var error = document.getElementById("token-error");
          if (box && code) {
            code.textContent = data.token;
            box.hidden = false;
          }
          if (error) error.hidden = true;
          var body = document.getElementById("token-rows");
          if (body) {
            var tr = document.createElement("tr");
            var cells = [data.name, data.scope.charAt(0).toUpperCase() + data.scope.slice(1), String(data.created_at).slice(0, 10), "Never"];
            for (var i = 0; i < cells.length; i += 1) {
              var td = document.createElement("td");
              td.textContent = cells[i];
              tr.appendChild(td);
            }
            var last = document.createElement("td");
            var button = document.createElement("button");
            button.type = "button";
            button.className = "btn-link";
            button.setAttribute("data-action", "revoke");
            button.setAttribute("data-id", data.id);
            button.textContent = "Revoke";
            last.appendChild(button);
            tr.appendChild(last);
            body.appendChild(tr);
          }
          form.reset();
        }, function (err) {
          var box = document.getElementById("token-error");
          if (box) {
            box.textContent = err && err.message ? err.message : String(err);
            box.hidden = false;
            return;
          }
          fail(err);
        });
      });
    }
  };

  var MODE_KEY = "rshow-mode";
  var MODES = ["system", "light", "dark"];
  var MODE_LABELS = { system: "System", light: "Light", dark: "Dark" };

  function normalizeMode(value) {
    return value === "light" || value === "dark" ? value : "system";
  }

  function readMode() {
    try { return normalizeMode(window.localStorage.getItem(MODE_KEY)); } catch (err) { return "system"; }
  }

  function applyMode(mode) {
    var root = document.documentElement;
    if (mode === "light" || mode === "dark") root.dataset.mode = mode;
    else delete root.dataset.mode;
  }

  function saveMode(mode) {
    try { window.localStorage.setItem(MODE_KEY, mode); } catch (err) { /* storage may be blocked */ }
    applyMode(mode);
  }

  function paintMode(toggle) {
    var mode = readMode();
    toggle.textContent = MODE_LABELS[mode];
    toggle.setAttribute("aria-label", "Color mode: " + MODE_LABELS[mode] + ". Activate to cycle System, Light, Dark.");
  }

  var modeToggle = document.getElementById("mode-toggle");
  if (modeToggle) {
    paintMode(modeToggle);
    modeToggle.addEventListener("click", function () {
      var next = MODES[(MODES.indexOf(readMode()) + 1) % MODES.length];
      saveMode(next);
      paintMode(modeToggle);
    });
  }

  document.addEventListener("change", function (event) {
    var el = event.target;
    if (!el || !el.matches || !el.matches("[data-submit-on-change]")) return;
    if (el.form) el.form.requestSubmit();
  });

  var nodes = document.querySelectorAll("[data-island]");
  for (var i = 0; i < nodes.length; i += 1) {
    var kind = nodes[i].getAttribute("data-island");
    var mount = islands[kind];
    if (mount) mount(nodes[i], propsOf(nodes[i]));
  }
})();
