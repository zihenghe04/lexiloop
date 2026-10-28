const PATHS = {
  search: "M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Zm5.3 12.8L21 21",
  book: "M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5zM4 5.5v16M8 7h8",
  stack: "M4 7.5 12 4l8 3.5-8 3.5-8-3.5Zm0 4.5 8 3.5 8-3.5M4 16.5 12 20l8-3.5",
  library: "M5 3h9l3 3v15H5zM14 3v4h4M8 12h6M8 15.5h6",
  review: "M12 3.5 21 8l-9 4.5L3 8l9-4.5ZM6 11v5.5l6 3 6-3V11",
  settings: "M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Zm8 3.8c0 .6-.05 1.1-.13 1.6l2 1.5-1.9 3.3-2.4-1a8 8 0 0 1-1.4.8l-.36 2.55h-3.8l-.35-2.55a8 8 0 0 1-1.4-.8l-2.4 1L3.9 14.9l2-1.5A8.6 8.6 0 0 1 5.8 12c0-.55.04-1.1.13-1.6l-2-1.5 1.9-3.3 2.4 1c.43-.3.9-.56 1.4-.8L9.99 3.3h3.8l.36 2.55c.5.24.97.5 1.4.8l2.4-1 1.9 3.3-2 1.5c.08.5.13 1.05.13 1.6Z",
  sun: "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  trash: "M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6",
  star: "m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z",
  external: "M14 4h6v6M20 4 11 13M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5",
  play: "M7 4.5 20 12 7 19.5z",
  pause: "M8 5v14M16 5v14",
  check: "M4.5 12.5 9 17l10.5-10.5",
  chevron: "M9 6l6 6-6 6",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  refresh: "M20 11a8 8 0 1 0-2.3 5.6M20 4v7h-7",
  paperclip: "M8 12.5V8a4 4 0 1 1 8 0v8a2.5 2.5 0 0 1-5 0V8",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3.5 2",
  key: "M15 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-3.2 5.7L4 20.5M7 17.5l2 2M4.5 20l1.5 1.5",
  text: "M5 6h14M12 6v13M8.5 19h7",
  copy: "M8 8h12v12H8zM16 8V4H4v12h4",
  send: "M12 19.5V5M6.5 10.5 12 5l5.5 5.5"
};

export default function Icon({ name, size = 16, className = "", strokeWidth = 2, filled = false }) {
  const d = PATHS[name] || PATHS.more;
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}