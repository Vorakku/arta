import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createGallery } from "./gallery/createGallery";
import { PROJECTS } from "./gallery/projects";
import type {
  GalleryController,
  GalleryUI,
  Hover,
  SelectedProject,
} from "./gallery/types";

const initialUI: GalleryUI = {
  mode: "intro",
  isTouch: false,
  ready: false,
  error: false,
  focused: false,
  panelOpen: false,
  selected: null,
  hover: null,
  toast: "",
  needsResume: false,
};
const hostOf = (url: string) =>
  url.replace(/^https?:\/\//, "").replace(/\/$/, "");
const numberOf = (index: number) => "NO. " + String(index + 1).padStart(2, "0");

function Caption({ hover }: { hover: Hover | null }) {
  // Keep the last caption during its original fade-out transition.
  const last = useRef<Hover | null>(null);
  useEffect(() => {
    if (hover) last.current = hover;
  }, [hover]);
  const item = hover ?? last.current;
  return (
    <div
      id="caption"
      className={[hover ? "on" : "", item?.far ? "far" : ""].join(" ")}
    >
      <div className="cap-top">
        <span id="capNo">{numberOf(item?.index ?? 0)}</span>
        <span id="capMeta">
          {item && item.project.year + " · " + item.project.tag}
        </span>
      </div>
      <div id="capTitle">{item?.project.title}</div>
      <div className="cap-bottom">
        <span id="capHost">{item && hostOf(item.project.url)}</span>
        <span id="capCta">{item?.cta ?? "VIEW WORK →"}</span>
      </div>
    </div>
  );
}

function ProjectPanel({
  selected,
  close,
  step,
  inIndex,
}: {
  selected: SelectedProject | null;
  close: () => void;
  step: (direction: number) => void;
  inIndex: boolean;
}) {
  const project = selected?.project;
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selected || !body.current) return;
    body.current.classList.remove("swap");
    void body.current.offsetWidth;
    body.current.classList.add("swap");
  }, [selected?.index]);
  return (
    <div id="pBody" ref={body} className={selected ? "swap" : ""}>
      <div className="p-head">
        <div className="p-kicker">
          <span className="p-no" id="pNo">
            {numberOf(selected?.index ?? 0)}
          </span>
          <span id="pMeta">
            {project && project.year + " · " + project.tag}
          </span>
        </div>
        <button
          id="pClose"
          type="button"
          aria-label={inIndex ? "Back to the index" : "Back to the room"}
          onClick={close}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
            <path
              d="M1 1l10 10M11 1L1 11"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
      <h2 id="pTitle">{project?.title}</h2>
      <div className="p-rule" />
      <figure className="p-plate">
        <img
          id="pImg"
          src={selected?.thumbnail || undefined}
          alt={project?.title ?? ""}
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
          onLoad={(event) => {
            event.currentTarget.hidden = false;
          }}
        />
        <figcaption id="pCap">
          {project &&
            project.w.toFixed(2) +
              " × " +
              project.h.toFixed(2) +
              " m" +
              (project.image ? "" : " · generative placeholder")}
        </figcaption>
      </figure>
      <p id="pDesc">{project?.desc}</p>
      <div className="p-link">
        <span className="p-linklabel">PROJECT URL</span>
        <span id="pHost">{project && hostOf(project.url)}</span>
      </div>
      <a id="pVisit" href={project?.url} target="_blank" rel="noopener">
        VISIT PROJECT&nbsp;&nbsp;→
      </a>
      <div className="p-foot">
        <button id="pPrev" type="button" onClick={() => step(-1)}>
          ←&nbsp;&nbsp;PREV
        </button>
        <span id="pCount">
          {(selected?.index ?? 0) + 1} / {PROJECTS.length}
        </span>
        <button id="pNext" type="button" onClick={() => step(1)}>
          NEXT&nbsp;&nbsp;→
        </button>
      </div>
      <p className="p-esc">ESC — BACK TO THE {inIndex ? "INDEX" : "ROOM"}</p>
    </div>
  );
}

function Toast({ text }: { text: string }) {
  const lastText = useRef("");
  useEffect(() => {
    if (text) lastText.current = text;
  }, [text]);
  return (
    <div id="toast" className={text ? "on" : ""}>
      {text || lastText.current}
    </div>
  );
}

function Intro({
  ui,
  start,
  viewIndex,
}: {
  ui: GalleryUI;
  start: () => void;
  viewIndex: () => void;
}) {
  return (
    <div
      id="overlay"
      className={ui.mode === "intro" || ui.mode === "paused" ? "" : "hidden"}
    >
      <div className="mat-line" />
      <div className="ov-inner">
        <div className="kicker" id="ovKicker">
          {ui.mode === "paused"
            ? "Paused — the room will wait"
            : "A Walkable Project Gallery"}
        </div>
        <h1>
          The <em>White</em> Room
        </h1>
        <p className="lede">
          Nine works, one white room. Take a quiet walk through the collection.
        </p>
        <div className="controls" id="ovControls">
          {ui.isTouch ? (
            <>
              <span>Left thumb — walk</span>
              <span>Right thumb — look</span>
              <span>Tap a work up close — view</span>
            </>
          ) : (
            <>
              <span>
                <kbd>W</kbd>
                <kbd>A</kbd>
                <kbd>S</kbd>
                <kbd>D</kbd> move
              </span>
              <span>Move mouse — turn</span>
              <span>
                <kbd>Q</kbd>
                <kbd>E</kbd> turn
              </span>
              <span>
                <kbd>Scroll</kbd> lean in
              </span>
              <span>
                <kbd>Click</kbd> view — stand close
              </span>
            </>
          )}
        </div>
        <button
          id="enter"
          type="button"
          disabled={!ui.ready || ui.error}
          onClick={start}
        >
          {!ui.ready
            ? "Preparing the room…"
            : ui.mode === "paused"
              ? "RESUME"
              : "ENTER THE GALLERY"}
        </button>
        <button id="viewIndex" type="button" onClick={viewIndex}>
          View the index
        </button>
      </div>
    </div>
  );
}

function ProjectIndex({
  open,
  choose,
  back,
  error,
}: {
  open: boolean;
  choose: (index: number) => void;
  back: () => void;
  error: boolean;
}) {
  return (
    <main id="projectIndex" hidden={!open} aria-labelledby="indexTitle">
      <header className="index-head">
        <div>
          <p className="kicker">The White Room · Nine Works</p>
          <h2 id="indexTitle" tabIndex={-1}>
            The index
          </h2>
        </div>
        {!error && (
          <button type="button" onClick={back}>
            Back to the room
          </button>
        )}
      </header>
      {error && (
        <p className="index-message" role="status">
          The room is unavailable in this browser. The works are here.
        </p>
      )}
      <ol className="index-list">
        {PROJECTS.map((project, index) => (
          <li key={project.title}>
            <p className="p-kicker">
              <span className="p-no">{numberOf(index)}</span>
              <span>
                {project.year} · {project.tag}
              </span>
            </p>
            <h3>
              <button type="button" onClick={() => choose(index)}>
                {project.title}
              </button>
            </h3>
            <p className="index-desc">{project.desc}</p>
            <a href={project.url} target="_blank" rel="noopener">
              {hostOf(project.url)}
            </a>
          </li>
        ))}
      </ol>
    </main>
  );
}

export default function App() {
  const [ui, setUI] = useState<GalleryUI>(initialUI);
  const [indexOpen, setIndexOpen] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const panel = useRef<HTMLElement>(null);
  const stick = useRef<HTMLDivElement>(null);
  const stickNub = useRef<HTMLDivElement>(null);
  const controller = useRef<GalleryController | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (
      !canvas.current ||
      !panel.current ||
      !stick.current ||
      !stickNub.current
    )
      return;
    try {
      const gallery = createGallery(
        {
          canvas: canvas.current,
          panel: panel.current,
          stick: stick.current,
          stickNub: stickNub.current,
        },
        (patch) => {
          if (patch.panelOpen && !panel.current?.classList.contains("on"))
            opener.current = canvas.current;
          const update = () =>
            setUI((previous) => ({
              ...previous,
              ...patch,
              ...(patch.ready && previous.selected && !patch.selected
                ? {
                    selected: {
                      ...previous.selected,
                      thumbnail:
                        controller.current?.thumbnail(
                          previous.selected.index,
                        ) ?? previous.selected.thumbnail,
                    },
                  }
                : {}),
            }));
          // Camera framing measures the panel immediately after choosing a work.
          // Commit its new content first, especially for the mobile bottom sheet.
          if (patch.selected) flushSync(update);
          else update();
        },
      );
      controller.current = gallery;
      return () => {
        gallery.dispose();
        controller.current = null;
      };
    } catch (error) {
      console.error("The gallery failed to initialize:", error);
      setUI((previous) => ({ ...previous, error: true }));
    }
  }, []);

  useEffect(() => {
    controller.current?.suspend(indexOpen);
  }, [indexOpen]);

  useEffect(() => {
    if (ui.error) setIndexOpen(true);
  }, [ui.error]);
  useEffect(() => {
    if (indexOpen) document.getElementById("indexTitle")?.focus();
  }, [indexOpen]);

  useEffect(() => {
    document.body.classList.toggle(
      "playing",
      ui.mode === "playing" || ui.mode === "focus",
    );
    document.body.classList.toggle("focused", ui.focused);
    document.body.classList.toggle("touch", ui.isTouch);
    return () => document.body.classList.remove("playing", "focused", "touch");
  }, [ui.mode, ui.focused, ui.isTouch]);

  useEffect(() => {
    if (!ui.panelOpen) return;
    let frame = 0;
    const focusClose = () => {
      const button = document.getElementById("pClose");
      // Wait for the panel's visibility transition before moving focus.
      if (button && getComputedStyle(button).visibility === "visible")
        button.focus({ preventScroll: true });
      else frame = requestAnimationFrame(focusClose);
    };
    frame = requestAnimationFrame(focusClose);
    return () => {
      cancelAnimationFrame(frame);
      opener.current?.focus({ preventScroll: true });
    };
  }, [ui.panelOpen]);

  const choose = (index: number) => {
    if (!ui.panelOpen)
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : canvas.current;
    const project = PROJECTS[index];
    setUI((previous) => ({
      ...previous,
      focused: true,
      panelOpen: true,
      selected: {
        project,
        index,
        thumbnail: controller.current?.thumbnail(index) ?? project.image ?? "",
      },
    }));
  };
  const viewIndex = () => {
    controller.current?.menu();
    setIndexOpen(true);
  };
  const close = () => {
    if (indexOpen)
      setUI((previous) => ({ ...previous, focused: false, panelOpen: false }));
    else controller.current?.close();
  };
  const step = (direction: number) => {
    if (indexOpen && ui.selected)
      choose(
        (ui.selected.index + direction + PROJECTS.length) % PROJECTS.length,
      );
    else controller.current?.step(direction);
  };
  return (
    <>
      <div id="gallerySurface" inert={ui.panelOpen}>
        <canvas
          id="scene"
          ref={canvas}
          tabIndex={0}
          aria-label="Walkable gallery"
        />
        <div
          id="reticle"
          className={ui.hover ? (ui.hover.far ? "far" : "hot") : ""}
          aria-hidden="true"
        />
        <header id="wordmark" className="plate">
          The White Room · Nine Works
        </header>
        <div id="hint" className="plate">
          Esc — pause
        </div>
        <Caption hover={ui.hover} />
        <Toast text={ui.toast} />
        {ui.needsResume && !indexOpen && (
          <button
            id="resumeLook"
            type="button"
            onClick={() => controller.current?.resume()}
          >
            Click to resume
          </button>
        )}
        <div id="stick" ref={stick}>
          <div id="stickNub" ref={stickNub} />
        </div>
        <button
          id="menuBtn"
          type="button"
          onClick={() => controller.current?.menu()}
        >
          Menu
        </button>
        <ProjectIndex
          open={indexOpen}
          choose={choose}
          back={() => setIndexOpen(false)}
          error={ui.error}
        />
        {!indexOpen && (
          <Intro
            ui={ui}
            start={() => controller.current?.start()}
            viewIndex={viewIndex}
          />
        )}
      </div>
      <aside
        id="panel"
        className={ui.panelOpen ? "on" : ""}
        role="dialog"
        inert={!ui.panelOpen}
        aria-hidden={!ui.panelOpen}
        aria-modal="true"
        aria-labelledby="pTitle"
        ref={panel}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            close();
          }
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            event.stopPropagation();
            step(event.key === "ArrowLeft" ? -1 : 1);
          }
          if (event.key !== "Tab") return;
          const controls = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled), a[href], [tabindex='0']",
            ),
          ].filter((element) => element.offsetParent !== null);
          const first = controls[0],
            last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <ProjectPanel
          selected={ui.selected}
          close={close}
          step={step}
          inIndex={indexOpen}
        />
      </aside>
    </>
  );
}
