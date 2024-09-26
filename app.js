// @ts-check

/**
 * Need to increment this number whenever there's a breaking change to the
 * format of the snapshots we save to disk between sessions.
 */
const snapshotVersion = 1;

let canvas = /** @type {HTMLCanvasElement} */ (
  document.getElementById("canvas")
);
let ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));

/**
 * @typedef {{
 *    x: number;
 *    y: number;
 * }} Point
 *
 * @typedef {{
 *    x: number;
 *    y: number;
 *    w: number;
 *    h: number;
 * }} Rectangle
 *
 * @typedef {{
 *    glyph: string;
 *    foregroundColor: string;
 *    backgroundColor: string;
 * }} Cell
 *
 * @typedef {{
 *    bounds: Rectangle;
 *    cells: Cell[];
 * }} Slice
 *
 * @typedef {{
 *  foreground: boolean;
 *  background: boolean;
 *  glyph: boolean;
 * }} Mask
 *
 * @typedef {{
 *   debug: boolean;
 *   cellWidth: number;
 *   cellHeight: number;
 *   fontSize: number;
 *   fontFamily: string;
 * }} Settings
 *
 * @typedef {({
 *    type: "paint";
 *    x: number;
 *    y: number;
 *    glyph: string;
 *    foregroundColor: string;
 *    backgroundColor: string;
 * } | {
 *    type: "blit";
 *    slice: Slice;
 * } | {
 *    type: "set-canvas-color";
 *    color: string;
 * } | {
 *    type: "resize";
 *    width: number;
 *    height: number;
 * })} Command
 *
 * @typedef {{
 *   version: 1;
 *   width: number;
 *   height: number;
 *   cells: Cell[];
 *   settings: Settings;
 *   undos: Command[];
 *   redos: Command[];
 *   currentForegroundColor: string;
 *   currentBackgroundColor: string;
 *   currentGlyph: string;
 * }} Snapshot
 *
 * @typedef {{ type: "pen" }} PenTool
 * @typedef {{ type: "eraser" }} EraserTool
 * @typedef {{ type: "text", x: number }} TextTool
 * @typedef {{ type: "select", p0: Point | undefined, p1: Point | undefined }} SelectTool
 * @typedef {{ type: "box-drawing", charset: string, p0: Point | undefined, p1: Point | undefined }} BoxDrawingTool
 * @typedef {{ type: "paste" }} PasteTool
 * @typedef {(PenTool | EraserTool | TextTool | SelectTool | BoxDrawingTool | PasteTool)} Tool
 *
 * @typedef {"none" | "glyph" | "foregroundColor" | "backgroundColor" | "canvasColor"} Picker
 *
 * @typedef {ReturnType<typeof app>} App
 */

function app() {
  return {
    /**
     * @type {Settings}
     */
    settings: {
      debug: false,
      cellWidth: 13,
      cellHeight: 26,
      fontSize: 20,
      fontFamily:
        "ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace",
    },

    /**
     * @type {Cell[]}
     */
    cells: [],

    /**
     * Width of the canvas in cells.
     */
    width: 48,

    /**
     * Height of the canvas in cells.
     */
    height: 24,

    /**
     * @type {Point | undefined}
     */
    cursor: undefined,

    /**
     * The current selection box.
     * @type {Rectangle | undefined}
     */
    selection: undefined,

    /**
     * The contents of the clipboard.
     * @type {Slice | undefined}
     */
    clipboard: undefined,

    /**
     * The foreground color for drawing.
     */
    currentForegroundColor: "white",

    /**
     * The background color for drawing.
     */
    currentBackgroundColor: "",

    /**
     * The glyph for drawing.
     */
    currentGlyph: "o",

    /**
     * The mask decides which channels are used when painting.
     * @type {Mask}
     */
    mask: {
      glyph: true,
      foreground: true,
      background: true,
    },

    /**
     * The color of the canvas.
     */
    canvasColor: "#171618",

    /**
     * A record of available glyph palettes.
     */
    glyphLibrary: glyphLibrary,

    /**
     * A record of available color palettes.
     */
    colorLibrary: colorLibrary,

    /**
     * A list of commands that can be undone.
     * @type {Command[]}
     */
    undos: [],

    /**
     * A list of commands that can be redone.
     * @type {Command[]}
     */
    redos: [],

    /**
     * @type {Tool | undefined}
     */
    currentTool: undefined,

    /**
     * A stack of tools to draw from to "restore" the previous tool.
     * @type {Tool[]}
     */
    toolStack: [],

    /**
     * @type {PenTool}
     */
    penTool: { type: "pen" },

    /**
     * @type {EraserTool}
     */
    eraserTool: { type: "eraser" },

    /**
     * @type {TextTool}
     */
    textTool: { type: "text", x: 0 },

    /**
     * @type {SelectTool}
     */
    selectTool: { type: "select", p0: undefined, p1: undefined },

    /**
     * @type {BoxDrawingTool}
     */
    boxDrawingTool: {
      type: "box-drawing",
      charset: "┌─┐│└─┘",
      p0: undefined,
      p1: undefined,
    },

    /**
     * @type {PasteTool}
     */
    pasteTool: { type: "paste" },

    /**
     * The picker to show the user.
     * @type {Picker}
     */
    currentPicker: "none",

    /**
     * A slice that the user is editing, but that hasn't been committed yet.
     * @type {Slice | undefined}
     */
    buffer: undefined,

    /**
     * @param {any} cond
     * @param {string} message
     * @return {asserts cond}
     */
    assert(cond, message) {
      // TODO: Instead of throwing, show a user-facing warning toast
      if (!cond) throw new Error(message);
    },

    /**
     * @param {number} x
     * @param {number} y
     */
    cell(x, y) {
      return (this.cells[x + y * this.width] ||= createEmptyCell());
    },

    /**
     * @return {Rectangle}
     */
    bounds() {
      return { x: 0, y: 0, w: this.width, h: this.height };
    },

    /**
     * Get all of the cells within the bounds of the rectangle.
     * @param {Rectangle} bounds
     * @return {Slice}
     */
    slice(bounds = this.bounds()) {
      let { x, y, w, h } = bounds;

      /**
       * @type {Cell[]}
       */
      let cells = [];

      for (let j = y; j < y + h; j++) {
        for (let i = x; i < x + w; i++) {
          let cell = this.cell(i, j);
          // Very important that we clone the cell here, so that mutating the
          // slice can't affect it later.
          cells.push({ ...cell });
        }
      }

      return { bounds, cells };
    },

    /**
     * Insert a slice into the grid.
     * @param {Slice} slice
     */
    splice(slice) {
      let { x, y, w, h } = slice.bounds;
      let empty = createEmptyCell();
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          let src = slice.cells[i + j * w] ?? empty;
          let dst = this.cell(x + i, y + j);
          if (src) {
            dst.glyph = src.glyph;
            dst.foregroundColor = src.foregroundColor;
            dst.backgroundColor = src.backgroundColor;
          }
        }
      }
    },

    /**
     * Check whether there's anything to undo.
     */
    canUndo() {
      return this.undos.length > 0;
    },

    /**
     * Check whether there's anything to redo.
     */
    canRedo() {
      return this.redos.length > 0;
    },

    /**
     * Undo the last command.
     */
    undo() {
      let command = this.undos.pop();
      if (command) {
        let redo = this.do(command);
        this.redos.push(redo);
        this.render();
      }
    },

    /**
     * Redo the last undo.
     */
    redo() {
      let command = this.redos.pop();
      if (command) {
        let undo = this.do(command);
        this.undos.push(undo);
        this.render();
      }
    },

    /**
     * Apply the effect of a command and return another command which will undo
     * that effect.
     * @param {Command} command
     * @return {Command}
     */
    do(command) {
      switch (command.type) {
        case "paint": {
          let cell = this.cell(command.x, command.y);
          let prevCell = { ...cell };
          cell.glyph = command.glyph;
          cell.foregroundColor = command.foregroundColor;
          cell.backgroundColor = command.backgroundColor;
          return {
            type: "paint",
            x: command.x,
            y: command.y,
            glyph: prevCell.glyph,
            foregroundColor: prevCell.foregroundColor,
            backgroundColor: prevCell.backgroundColor,
          };
        }

        case "blit": {
          let prevSlice = this.slice(command.slice.bounds);
          this.splice(command.slice);
          return {
            type: "blit",
            slice: prevSlice,
          };
        }

        case "set-canvas-color": {
          let prevCanvasColor = this.canvasColor;
          this.canvasColor = command.color;
          return {
            type: "set-canvas-color",
            color: prevCanvasColor,
          };
        }

        case "resize": {
          let { width, height } = this;
          this.resize(command.width, command.height);
          return {
            type: "resize",
            width,
            height,
          };
        }
      }
    },

    /**
     * Execute a command and update the undo/redo stacks accordingly.
     * @param {Command} command
     */
    execute(command) {
      let undo = this.do(command);
      this.undos.push(undo);
      // Executing a command branches the history, meaning that any redos may
      // become invalid, so we clear the stack.
      this.redos = [];
      // Render after any command
      this.render();
    },

    /**
     * Check whether it's possible to paint a given cell. It will not be
     * possible if the cell is out of bounds or if it's not inside the
     * current selection.
     * @param {number} x
     * @param {number} y
     */
    canPaintAt(x, y) {
      let bounds = this.selection ?? {
        x: 0,
        y: 0,
        w: this.width,
        h: this.height,
      };
      return (
        x >= bounds.x &&
        y >= bounds.y &&
        x < bounds.x + bounds.w &&
        y < bounds.y + bounds.h
      );
    },

    /**
     * Paint at the cell under the cursor.
     */
    paint() {
      // Can't paint if the cursor isn't on the canvas.
      if (this.cursor === undefined) {
        return;
      }

      // Bail if we can't paint here
      if (!this.canPaintAt(this.cursor.x, this.cursor.y)) {
        return;
      }

      let cell = this.cell(this.cursor.x, this.cursor.y);

      // Default is to preserve the existing values of the cell
      let { glyph, foregroundColor, backgroundColor } = cell;

      // Change the defaults if any masks are set
      if (this.mask.glyph) glyph = this.currentGlyph;
      if (this.mask.foreground) foregroundColor = this.currentForegroundColor;
      if (this.mask.background) backgroundColor = this.currentBackgroundColor;

      // Bail out if the cell is already set to these values.
      if (
        cell.glyph === glyph &&
        cell.foregroundColor === foregroundColor &&
        cell.backgroundColor === backgroundColor
      ) {
        return;
      }

      this.execute({
        type: "paint",
        x: this.cursor.x,
        y: this.cursor.y,
        glyph,
        foregroundColor,
        backgroundColor,
      });
    },

    /**
     * Erase the cell under the cursor.
     */
    erase() {
      // Can't erase if the cursor isn't on the canvas.
      if (this.cursor === undefined) {
        return;
      }

      let cell = this.cell(this.cursor.x, this.cursor.y);

      // Bail out if the cell is already set to these values.
      if (
        cell.glyph === "" &&
        cell.foregroundColor === "" &&
        cell.backgroundColor === ""
      ) {
        return;
      }

      this.execute({
        type: "paint",
        x: this.cursor.x,
        y: this.cursor.y,
        glyph: "",
        foregroundColor: "",
        backgroundColor: "",
      });
    },

    /**
     * Clear a rectangle of the canvas. If no rectangle is passed, defaults to
     * clearing the current selection, and if there's no selection, then clears
     * the entire grid.
     * @param {Rectangle} bounds
     */
    clear(bounds = this.selection ?? this.bounds()) {
      this.execute({
        type: "blit",
        slice: { bounds, cells: [] },
      });
      return this.deselect();
    },

    /**
     * Commit the buffer to the grid and remove the buffer.
     */
    commit() {
      if (!this.buffer) return;
      this.execute({ type: "blit", slice: this.buffer });
      this.buffer = undefined;
      this.selection = undefined;
    },

    /**
     * Fill the current selection.
     */
    fillCurrentSelection() {
      if (!this.selection) return;
      let slice = this.slice(this.selection);

      for (let cell of slice.cells) {
        if (!cell) continue;
        if (this.mask.glyph) cell.glyph = this.currentGlyph;
        if (this.mask.foreground)
          cell.foregroundColor = this.currentForegroundColor;
        if (this.mask.background)
          cell.backgroundColor = this.currentBackgroundColor;
      }

      this.execute({ type: "blit", slice });
    },

    /**
     * Resize the canvas.
     * @param {number} width
     * @param {number} height
     */
    resize(width, height) {
      let { cellWidth, cellHeight, fontSize, fontFamily } = this.settings;
      this.width = width;
      this.height = height;
      canvas.width = width * cellWidth * window.devicePixelRatio;
      canvas.height = height * cellHeight * window.devicePixelRatio;
      canvas.style.width = width * cellWidth + "px";
      canvas.style.height = height * cellHeight + "px";
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `${fontSize}px ${fontFamily}`;
    },

    /**
     * Render the current state of the cells to the canvas.
     */
    render() {
      let { cellWidth, cellHeight } = this.settings;

      ctx.clearRect(0, 0, this.width * cellWidth, this.height * cellHeight);

      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          let cell = this.cell(x, y);
          this.renderCell(x, y, cell);
        }
      }

      if (this.buffer) {
        for (let y = 0; y < this.buffer.bounds.h; y++) {
          for (let x = 0; x < this.buffer.bounds.w; x++) {
            let cell = this.buffer.cells[x + y * this.buffer.bounds.w];
            if (cell) {
              this.renderCell(
                this.buffer.bounds.x + x,
                this.buffer.bounds.y + y,
                cell,
              );
            }
          }
        }
      }

      if (this.cursor) {
        ctx.strokeStyle = "white";
        ctx.lineWidth = 3;
        ctx.strokeRect(
          this.cursor.x * cellWidth,
          this.cursor.y * cellHeight,
          cellWidth,
          cellHeight,
        );
      }

      if (this.selection) {
        ctx.save();
        ctx.setLineDash([8, 8]);
        ctx.strokeStyle = "white";
        ctx.lineWidth = 3;
        ctx.strokeRect(
          this.selection.x * cellWidth,
          this.selection.y * cellHeight,
          this.selection.w * cellWidth,
          this.selection.h * cellHeight,
        );
        ctx.restore();
      }
    },

    /**
     * Render a single cell at specific coordinates.
     * @param {number} x
     * @param {number} y
     * @param {Cell} cell
     */
    renderCell(x, y, cell) {
      let { cellWidth, cellHeight } = this.settings;

      if (cell.backgroundColor) {
        ctx.fillStyle = cell.backgroundColor;
        ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
      }

      if (cell.glyph && cell.foregroundColor) {
        ctx.fillStyle = cell.foregroundColor;
        ctx.fillText(
          cell.glyph,
          x * cellWidth + cellWidth / 2,
          y * cellHeight + cellHeight / 2,
        );
      }
    },

    /**
     * Convert a point in screen coordinates into cell coordinates.
     * @param {number} screenX
     * @param {number} screenY
     * @return {Point}
     */
    screenToGrid(screenX, screenY) {
      let bounds = canvas.getBoundingClientRect();
      let x = (screenX - bounds.x) / this.settings.cellWidth;
      let y = (screenY - bounds.y) / this.settings.cellHeight;
      return { x: Math.floor(x), y: Math.floor(y) };
    },

    /**
     * Set the coordinates of the cursor.
     * @param {number} x
     * @param {number} y
     */
    setCursor(x, y) {
      let inside = x >= 0 && y >= 0 && x < this.width && y < this.height;
      this.cursor = inside ? { x, y } : undefined;
      this.render();
    },

    /**
     * @param {Tool} tool
     */
    setTool(tool) {
      this.currentTool = tool;
      this.toolStack = [];
    },

    /**
     * @param {Tool} tool
     */
    pushTool(tool) {
      if (this.currentTool) {
        this.toolStack.push(this.currentTool);
      }
      this.currentTool = tool;
    },

    /**
     * Restore the previous/default tool.
     */
    popTool() {
      let tool = this.toolStack.pop() ?? this.penTool;
      this.currentTool = tool;
    },

    /**
     * @param {Rectangle} rect
     */
    select({ x, y, w, h }) {
      this.selection = { x, y, w, h };
    },

    /**
     *
     */
    deselect() {
      this.selection = undefined;
    },

    /**
     * Open a picker.
     * @param {Picker} picker
     */
    openPicker(picker) {
      this.currentPicker = picker;
    },

    /**
     * Open a picker.
     * @param {Picker} picker
     */
    togglePicker(picker) {
      if (this.currentPicker === picker) {
        this.currentPicker = "none";
      } else {
        this.currentPicker = picker;
      }
    },

    closePicker() {
      this.currentPicker = "none";
    },

    /**
     * @param {string} glyph
     */
    pickGlyph(glyph) {
      this.currentGlyph = glyph;
      this.closePicker();
    },

    /**
     * @param {string} color
     */
    pickColor(color) {
      if (this.currentPicker === "foregroundColor") {
        this.currentForegroundColor = color;
      } else if (this.currentPicker === "backgroundColor") {
        this.currentBackgroundColor = color;
      } else if (this.currentPicker === "canvasColor") {
        this.execute({ type: "set-canvas-color", color });
      }

      this.closePicker();
    },

    /**
     * Copy the current cell or selection to the clipboard.
     */
    copy() {
      if (this.selection) {
        this.clipboard = this.slice(this.selection);
      } else if (this.cursor) {
        this.clipboard = this.slice({
          x: this.cursor.x,
          y: this.cursor.y,
          w: 1,
          h: 1,
        });
      }
    },

    /**
     * Cut the current cell or selection to the clipboard.
     */
    cut() {
      this.copy();
      this.clear();
      this.deselect();
    },

    /**
     * Paste the contents of the clipboard.
     */
    paste() {
      if (this.clipboard) {
        let bounds = {
          x: this.cursor?.x ?? this.clipboard.bounds.x,
          y: this.cursor?.y ?? this.clipboard.bounds.y,
          w: this.clipboard.bounds.w,
          h: this.clipboard.bounds.h,
        };

        this.buffer = { bounds, cells: this.clipboard.cells };
        this.selection = bounds;
        this.pushTool(this.pasteTool);
      }
    },

    /**
     * @return {string}
     */
    getCurrentPickerColor() {
      switch (this.currentPicker) {
        case "foregroundColor":
          return this.currentForegroundColor;
        case "backgroundColor":
          return this.currentBackgroundColor;
        case "canvasColor":
          return this.canvasColor;
        default:
          return "transparent";
      }
    },

    /**
     * @param {PointerEvent} event
     */
    setCursorFromEvent(event) {
      let { x, y } = this.screenToGrid(event.x, event.y);
      this.setCursor(x, y);
    },

    /**
     * @param {PointerEvent | KeyboardEvent} event
     */
    handleEvent(event) {
      // Allow the current tool to handle the event first. If it return `true`
      // then consider the event "handled" and stop processing.
      if (this.handleToolEvents(event)) {
        this.render();
        return;
      }

      // If the event wasn't handled by a tool, then try it against the global
      // keyboard shortcuts.
      if (event instanceof KeyboardEvent) {
        this.handleGlobalKeyboardShortcuts(event);
        this.render();
        return;
      }
    },

    /**
     * @param {DragEvent} event
     */
    async handleDrop(event) {
      event.preventDefault();
      let file = event.dataTransfer?.files[0];
      if (!file) return;

      // RexPaint
      if (file.name.endsWith(".xp")) {
        let slices = await parseRexPaintFile(file);
        let slice = slices[0];
        this.cells = [];
        this.resize(slice.bounds.w, slice.bounds.h);
        this.splice(slice);
        return;
      }

      if (file.name.endsWith(".txt")) {
        let slice = await parseTxtFile(file);
        this.cells = [];
        this.resize(slice.bounds.w, slice.bounds.h);
        this.splice(slice);
        return;
      }
    },

    /**
     * @param {PointerEvent | KeyboardEvent} event
     * @return {boolean}
     */
    handleToolEvents(event) {
      switch (this.currentTool?.type) {
        case undefined:
          return false;
        case "pen":
          return handlePenToolEvent(this, event);
        case "eraser":
          return handleEraserToolEvent(this, event);
        case "text":
          return handleTextToolEvent(this, event);
        case "select":
          return handleSelectToolEvent(this, event);
        case "box-drawing":
          return handleBoxDrawingToolEvent(this, event);
        case "paste":
          return handlePasteToolEvent(this, event);
      }
    },

    /**
     * @param {KeyboardEvent} event
     */
    handleGlobalKeyboardShortcuts(event) {
      if (shouldIgnoreKeypress(event)) return;

      let { key, metaKey: meta, shiftKey: shift, ctrlKey: ctrl } = event;

      // Ignore workspace switching keypresses.
      if (meta && key >= "0" && key <= "9") return;

      // Escape (clearing selection)
      if (key === "Escape" && this.selection) {
        this.deselect();
        return true;
      }

      // Enter (filling the current selection)
      if (key === "Enter" && this.selection) {
        this.fillCurrentSelection();
        this.deselect();
        return true;
      }

      // Escape (resetting tool)
      if (key === "Escape") {
        this.popTool();
        return true;
      }

      // Redo
      if ((meta && shift && key === "z") || (ctrl && key === "r")) {
        event.preventDefault();
        this.redo();
        return true;
      }

      // Undo
      if ((meta && key === "z") || key === "u") {
        event.preventDefault();
        this.undo();
        return true;
      }

      // Copy
      if ((meta && key === "c") || key === "y") {
        event.preventDefault();
        this.copy();
        return true;
      }

      // Cut
      if ((meta && key === "x") || key === "x") {
        event.preventDefault();
        this.cut();
        return true;
      }

      // Paste
      if (
        ((meta && key === "v") || key === "p") &&
        this.clipboard &&
        this.cursor
      ) {
        event.preventDefault();
        this.paste();
        return true;
      }

      // Select all
      if (meta && key === "a") {
        this.select(this.bounds());
        return true;
      }

      // Toggle debug
      if (key === "D") {
        this.settings.debug = !this.settings.debug;
        return true;
      }

      // Swap foreground/background colors
      if (shift && key === "C") {
        let foregroundColor = this.currentForegroundColor;
        let backgroundColor = this.currentBackgroundColor;
        this.currentForegroundColor = backgroundColor;
        this.currentBackgroundColor = foregroundColor;
        return true;
      }

      if (key === "h") return this.resize(90, 12);

      // Mask shortcuts
      if (key === "a") return (this.mask = { ...defaultMask });
      if (key === "F") return (this.mask = { ...foregroundColorOnlyMask });
      if (key === "B") return (this.mask = { ...backgroundColorOnlyMask });
      if (key === "G") return (this.mask = { ...glyphOnlyMask });
      if (key === "f") return (this.mask.foreground = !this.mask.foreground);
      if (key === "b") return (this.mask.background = !this.mask.background);
      if (key === "g") return (this.mask.glyph = !this.mask.glyph);

      // Export shortcuts
      if (meta && key === "e") return download(this, "json");
      if (meta && key === "i") return download(this, "txt");

      if (meta && key === "p") {
        event.preventDefault();
        return download(this, "png");
      }

      if (meta && key === "s") {
        event.preventDefault();
        return download(this, "svg");
      }

      // Picker shortcuts
      if (key === "1") return this.togglePicker("glyph");
      if (key === "2") return this.togglePicker("foregroundColor");
      if (key === "3") return this.togglePicker("backgroundColor");
      if (key === "4") return this.togglePicker("canvasColor");

      // Tool shortcuts
      if (key === "p") return this.setTool(this.penTool);
      if (key === "e") return this.setTool(this.eraserTool);
      if (key === "m") return this.setTool(this.selectTool);
      if (key === "t") return this.setTool(this.textTool);
      if (key === "r") return this.setTool(this.boxDrawingTool);

      // If the user hasn't set the cursor yet, then start it from the origin.
      let cursor = this.cursor || { x: 0, y: 0 };

      // Cursor shortcuts
      if (key === "h" || key === "ArrowLeft")
        return this.setCursor(cursor.x - 1, cursor.y);
      if (key === "j" || key === "ArrowDown")
        return this.setCursor(cursor.x, cursor.y + 1);
      if (key === "k" || key === "ArrowUp")
        return this.setCursor(cursor.x, cursor.y - 1);
      if (key === "l" || key === "ArrowRight")
        return this.setCursor(cursor.x + 1, cursor.y);

      // Generic shortcuts
      if (key === "Backspace" || key === "Delete") return this.clear();
    },

    /**
     * Create a serializable snapshot of the state of the app.
     * @return {Snapshot}
     */
    snapshot() {
      return {
        version: snapshotVersion,
        settings: this.settings,
        width: this.width,
        height: this.height,
        cells: this.cells,
        undos: this.undos,
        redos: this.redos,
        currentForegroundColor: this.currentForegroundColor,
        currentBackgroundColor: this.currentBackgroundColor,
        currentGlyph: this.currentGlyph,
      };
    },

    /**
     * Save a snapshot of the app to localstorage.
     */
    saveSnapshot() {
      let snapshot = this.snapshot();
      saveSnapshotToLocalStorage(snapshot);
    },

    /**
     * Load a snapshot of the app from localstorage.
     */
    loadSnapshot() {
      let snapshot = loadSnapshotFromLocalStorage();

      if (snapshot) {
        this.cells = snapshot.cells;
        this.width = snapshot.width;
        this.height = snapshot.height;
        this.settings = snapshot.settings;
        this.undos = snapshot.undos;
        this.redos = snapshot.redos;
        this.currentForegroundColor = snapshot.currentForegroundColor;
        this.currentBackgroundColor = snapshot.currentBackgroundColor;
        this.currentGlyph = snapshot.currentGlyph;
      }
    },

    /**
     * Initialize the app and return it.
     */
    init() {
      this.loadSnapshot();
      this.currentTool = this.penTool;
      this.resize(this.width, this.height);
      this.render();
      return this;
    },
  };
}

/**
 * @param {App} app
 * @param {PointerEvent | KeyboardEvent} event
 * @return {boolean}
 */
function handlePenToolEvent(app, event) {
  if (event instanceof PointerEvent && event.buttons === 1) {
    // Ignore clicks on stuff outside the canvas
    if (event.type === "pointerdown" && event.target !== canvas) {
      return false;
    }

    let pos = app.screenToGrid(event.clientX, event.clientY);

    // Alt+click to sample
    if (event.altKey) {
      let cell = app.cell(pos.x, pos.y);
      app.currentGlyph = cell.glyph;
      app.currentBackgroundColor = cell.backgroundColor;
      app.currentForegroundColor = cell.foregroundColor;
      return true;
    }

    // Left click to paint
    app.paint();
    return true;
  }

  return false;
}

/**
 * @param {App} app
 * @param {PointerEvent | KeyboardEvent} event
 * @return {boolean}
 */
function handleEraserToolEvent(app, event) {
  if (event instanceof PointerEvent && event.buttons === 1) {
    // Ignore clicks on stuff outside the canvas
    if (event.type === "pointerdown" && event.target !== canvas) {
      return false;
    }

    app.erase();
    return true;
  }

  return false;
}

/**
 * @param {App} app
 * @param {PointerEvent | KeyboardEvent} event
 * @return {boolean}
 */
function handleTextToolEvent(app, event) {
  let { cursor, textTool: tool } = app;

  if (event.type === "pointerdown" && cursor) {
    app.textTool.x = cursor.x;
    return true;
  }

  if (!(event instanceof KeyboardEvent)) return false;
  if (event.type !== "keydown") return false;
  if (!cursor) return false;

  let { key } = event;

  if (key === "Escape") {
    app.popTool();
  } else if (key === "Backspace") {
    app.erase();
    app.setCursor(cursor.x - 1, cursor.y);
  } else if (key === "Enter") {
    app.setCursor(tool.x, cursor.y + 1);
  } else if (key === "ArrowLeft") {
    app.setCursor(cursor.x - 1, cursor.y);
  } else if (key === "ArrowRight") {
    app.setCursor(cursor.x + 1, cursor.y);
  } else if (key === "ArrowUp") {
    app.setCursor(cursor.x, cursor.y - 1);
  } else if (key === "ArrowDown") {
    app.setCursor(cursor.x, cursor.y + 1);
  } else if (key.length === 1) {
    let cell = app.cell(cursor.x, cursor.y);
    app.execute({
      type: "paint",
      x: cursor.x,
      y: cursor.y,
      glyph: key,
      foregroundColor: app.mask.foreground
        ? app.currentForegroundColor
        : cell.foregroundColor,
      backgroundColor: app.mask.background
        ? app.currentBackgroundColor
        : cell.backgroundColor,
    });
    app.setCursor(cursor.x + 1, cursor.y);
  }

  // Text tool handles all keypresses whilst it is active.
  return true;
}

/**
 * @param {App} app
 * @param {PointerEvent | KeyboardEvent} event
 * @return {boolean}
 */
function handleSelectToolEvent(app, event) {
  let { selectTool: tool, selection, cursor, buffer } = app;

  let esc = event instanceof KeyboardEvent && event.key === "Escape";
  let isPointerDown = event.type === "pointerdown";
  let isPointerMove = event.type === "pointermove";
  let isPointerUp = event.type === "pointerup";

  // Esc during a selection move commits the selection and deselects.
  if (esc && buffer) {
    app.commit();
    app.deselect();
    return true;
  }

  // Esc during a selection deselects.
  if (esc && selection) {
    app.deselect();
    return true;
  }

  // Esc with no selection restores the previous/default tool.
  if (esc) {
    app.popTool();
    return true;
  }

  // Click inside a selection switches us into move mode.
  if (
    isPointerDown &&
    selection &&
    cursor &&
    isPointInRectangle(cursor, selection)
  ) {
    tool.p0 = { x: cursor.x, y: cursor.y };
    tool.p1 = { x: selection.x, y: selection.y };
    app.buffer = app.slice(selection);
    app.clear(selection);
    return true;
  }

  // Move with a buffer moves the buffer.
  if (isPointerMove && buffer && cursor && tool.p0 && tool.p1) {
    let offsetX = tool.p1.x - tool.p0.x;
    let offsetY = tool.p1.y - tool.p0.y;
    buffer.bounds.x = cursor.x + offsetX;
    buffer.bounds.y = cursor.y + offsetY;
    app.select(buffer.bounds);
    return true;
  }

  // If the mouse is released with a buffer, then commit the buffer.
  if (isPointerUp && buffer) {
    tool.p0 = undefined;
    tool.p1 = undefined;
    app.commit();
    return true;
  }

  // If the pointer is down, set p0 unless it is already set.
  if (isPointerDown) {
    tool.p0 ||= cursor;
  }

  // If pointer moves whilst p0 is set, set p1.
  if (isPointerMove && cursor && tool.p0) {
    tool.p1 = cursor;
  }

  // If pointer moves whilst both points are set, update the selection.
  if (isPointerMove && tool.p0 && tool.p1) {
    let bounds = createRectangleFromPoints([tool.p0, tool.p1]);
    app.select(bounds);
  }

  // Reset the points when the pointer is released.
  if (isPointerUp) {
    tool.p0 = undefined;
    tool.p1 = undefined;
  }

  return false;
}

/**
 *@param {App} app
 * @param {PointerEvent | KeyboardEvent} event
 * @return {boolean}
 */
function handleBoxDrawingToolEvent(app, event) {
  let tool = app.boxDrawingTool;
  let handled = false;

  if (event instanceof KeyboardEvent && event.type === "keydown") {
    if (event.key === "Escape") {
      tool.p0 = undefined;
      tool.p1 = undefined;
      app.popTool();
      return true;
    }
  }

  if (event instanceof PointerEvent) {
    let pos = app.screenToGrid(event.clientX, event.clientY);

    if (event.type === "pointerdown") {
      tool.p0 ||= pos;
    }

    if (tool.p0) {
      tool.p1 = pos;
    }

    if (event.type === "pointerup") {
      app.commit();
      tool.p0 = undefined;
      tool.p1 = undefined;
    }

    handled = true;
  }

  if (tool.p0 && tool.p1) {
    let bounds = createRectangleFromPoints([tool.p0, tool.p1]);
    let slice = createEmptySlice(bounds);

    boxDrawing(
      { x: 0, y: 0, w: bounds.w, h: bounds.h },
      tool.charset,
      (x, y, glyph) => {
        let cell = app.cell(bounds.x + x, bounds.y + y);

        slice.cells[x + y * bounds.w] = {
          glyph: app.mask.glyph ? glyph : cell.glyph,
          foregroundColor: app.mask.foreground
            ? app.currentForegroundColor
            : cell.foregroundColor,
          backgroundColor: app.mask.background
            ? app.currentBackgroundColor
            : cell.backgroundColor,
        };
      },
    );

    app.buffer = slice;
  }

  return handled;
}

/**
 * @param {App} app
 * @param {PointerEvent | KeyboardEvent} event
 * @return {boolean}
 */
function handlePasteToolEvent(app, event) {
  if (!app.buffer) return false;

  if (event instanceof PointerEvent) {
    if (event.type === "pointerdown") {
      app.commit();
      app.popTool();
      return true;
    }

    if (event.type === "pointermove") {
      let pos = app.screenToGrid(event.clientX, event.clientY);
      app.buffer.bounds.x = pos.x;
      app.buffer.bounds.y = pos.y;
      return true;
    }
  }

  if (event instanceof KeyboardEvent && event.type === "keydown") {
    if (event.key === "Enter") {
      app.commit();
      app.popTool();
      return true;
    } else if (event.key === "Escape") {
      app.buffer = undefined;
      app.popTool();
      return true;
    } else if (event.key === "ArrowLeft" || event.key === "h") {
      app.buffer.bounds.x -= 1;
      return true;
    } else if (event.key === "ArrowRight" || event.key === "l") {
      app.buffer.bounds.x += 1;
      return true;
    } else if (event.key === "ArrowUp" || event.key === "k") {
      app.buffer.bounds.y -= 1;
      return true;
    } else if (event.key === "ArrowLeft" || event.key === "j") {
      app.buffer.bounds.y += 1;
      return true;
    }
  }

  return false;
}

/**
 * @return {Cell}
 */
function createEmptyCell() {
  return {
    glyph: "",
    foregroundColor: "",
    backgroundColor: "",
  };
}

/**
 * @param {Rectangle} bounds
 * @return {Slice}
 */
function createEmptySlice(bounds) {
  return { bounds, cells: [] };
}

/**
 * @param {Rectangle} bounds
 * @param {string} charset
 * @param {(x: number, y: number, char: string) => void} callback
 */
function boxDrawing(bounds, charset, callback) {
  let x0 = bounds.x;
  let y0 = bounds.y;
  let x1 = bounds.x + bounds.w - 1;
  let y1 = bounds.y + bounds.h - 1;

  for (let x = x0 + 1; x < x1; x++) {
    callback(x, y0, charset[1]);
    callback(x, y1, charset[1]);
  }

  for (let y = y0 + 1; y < y1; y++) {
    callback(x0, y, charset[3]);
    callback(x1, y, charset[3]);
  }

  callback(x0, y0, charset[0]);
  callback(x1, y0, charset[2]);
  callback(x0, y1, charset[4]);
  callback(x1, y1, charset[6]);
}

/**
 * @param {any} snapshot
 * @return {snapshot is Snapshot}
 */
function isCompatibleSnapshot(snapshot) {
  return snapshot.version === snapshotVersion;
}

/**
 * @param {Snapshot} snapshot
 */
function saveSnapshotToLocalStorage(snapshot) {
  let json = JSON.stringify(snapshot);
  localStorage.setItem("snapshot", json);
}

/**
 * @return {Snapshot | undefined}
 */
function loadSnapshotFromLocalStorage() {
  let json = localStorage.getItem("snapshot");
  if (!json) return;

  let snapshot = JSON.parse(json);
  if (!snapshot) return;

  if (!isCompatibleSnapshot(snapshot)) return;
  return snapshot;
}

/**
 * @param {App} app
 * @return {string} The canvas as plain text.
 */
function renderToText(app) {
  let str = "";

  for (let y = 0; y < app.height; y++) {
    for (let x = 0; x < app.width; x++) {
      let cell = app.cell(x, y);
      str += cell.glyph || " ";
    }
    str += "\n";
  }

  return str;
}

/**
 * @param {App} app
 * @return {string} The base64 encoded data url of the resulting PNG.
 */
function renderToPng(app) {
  let canvas = document.createElement("canvas");
  let ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
  let { cellWidth, cellHeight, fontSize, fontFamily } = app.settings;

  canvas.width = app.width * cellWidth;
  canvas.height = app.height * cellHeight;
  ctx.font = `${fontSize}px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = app.canvasColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < app.height; y++) {
    for (let x = 0; x < app.width; x++) {
      let cell = app.cell(x, y);
      if (cell.backgroundColor) {
        ctx.fillStyle = cell.backgroundColor;
        ctx.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
      }
      if (cell.foregroundColor && cell.glyph) {
        ctx.fillStyle = cell.foregroundColor;
        ctx.fillText(cell.glyph, (x + 0.5) * cellWidth, (y + 0.5) * cellHeight);
      }
    }
  }

  return canvas.toDataURL();
}

/**
 * @param {App} app
 * @return {string} The SVG string from the canvas.
 */
function renderToSvg(app) {
  let { cellWidth, cellHeight, fontSize, fontFamily } = app.settings;
  let width = app.width * cellWidth;
  let height = app.height * cellHeight;

  // prettier-ignore
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${fontFamily}" font-size="${fontSize}" text-anchor="middle" dominant-baseline="middle">`;

  if (app.canvasColor) {
    svg += `<rect width="${width}" height="${height}" fill="${app.canvasColor}" />`;
  }

  for (let y = 0; y < app.height; y++) {
    for (let x = 0; x < app.width; x++) {
      let cell = app.cell(x, y);

      let glyph = cell.glyph
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/'/g, "&apos;")
        .replace(/"/g, "&quot;");

      if (cell.backgroundColor) {
        // prettier-ignore
        svg += `<rect x="${x * cellWidth}" y="${y * cellHeight}" width="${cellWidth}" height="${cellHeight}" fill="${cell.backgroundColor}" />`;
      }

      if (cell.foregroundColor && cell.glyph) {
        // prettier-ignore
        svg += `<text x="${(x + 0.5) * cellWidth}" y="${(y + 0.5) * cellHeight}" fill="${cell.foregroundColor}">${glyph}</text>`;
      }
    }
  }

  svg += `</svg>`;

  return svg;
}

/**
 * @param {Point} point
 * @param {Rectangle} rectangle
 * @return {boolean}
 */
function isPointInRectangle(point, rectangle) {
  return (
    point.x >= rectangle.x &&
    point.y >= rectangle.y &&
    point.x < rectangle.x + rectangle.w &&
    point.y < rectangle.y + rectangle.h
  );
}

/**
 * @param {Point[]} points
 * @return {Rectangle}
 */
function createRectangleFromPoints(points) {
  let xs = points.map((point) => point.x);
  let ys = points.map((point) => point.y);
  let x0 = Math.min(...xs);
  let y0 = Math.min(...ys);
  let x1 = Math.max(...xs);
  let y1 = Math.max(...ys);
  let w = x1 - x0 + 1;
  let h = y1 - y0 + 1;
  return { x: x0, y: y0, w, h };
}

/**
 * @param {number} start
 * @param {number} end
 * @return {string[]}
 */
function createGlyphRange(start, end) {
  /** @type {string[]} */
  let glyphs = [];
  for (let i = start; i < end; i++) {
    glyphs.push(String.fromCharCode(i));
  }
  return glyphs;
}

/**
 * @param {KeyboardEvent} event
 */
function shouldIgnoreKeypress(event) {
  return (
    event.type !== "keydown" ||
    (event.target instanceof HTMLElement &&
      (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA"))
  );
}

/**
 * @type {Mask}
 */
const defaultMask = {
  glyph: true,
  foreground: true,
  background: true,
};

/**
 * @type {Mask}
 */
const glyphOnlyMask = { glyph: true, foreground: false, background: false };

/**
 * @type {Mask}
 */
const foregroundColorOnlyMask = {
  glyph: false,
  foreground: true,
  background: false,
};

/**
 * @type {Mask}
 */
const backgroundColorOnlyMask = {
  glyph: false,
  foreground: false,
  background: true,
};

// prettier-ignore
const cp437 = [
	0x0000,	0x263A,	0x263B,	0x2665,	0x2666,	0x2663,	0x2660,	0x2022,	0x25D8,	0x25CB,	0x25D9,	0x2642,	0x2640,	0x266A,	0x266B,	0x263C,
	0x25BA,	0x25C4,	0x2195,	0x203C,	0x00B6,	0x00A7,	0x25AC,	0x21A8,	0x2191,	0x2193,	0x2192,	0x2190,	0x221F,	0x2194,	0x25B2,	0x25BC,
	0x0020,	0x0021,	0x0022,	0x0023,	0x0024,	0x0025,	0x0026,	0x0027,	0x0028,	0x0029,	0x002A,	0x002B,	0x002C,	0x002D,	0x002E,	0x002F,
	0x0030,	0x0031,	0x0032,	0x0033,	0x0034,	0x0035,	0x0036,	0x0037,	0x0038,	0x0039,	0x003A,	0x003B,	0x003C,	0x003D,	0x003E,	0x003F,
	0x0040,	0x0041,	0x0042,	0x0043,	0x0044,	0x0045,	0x0046,	0x0047,	0x0048,	0x0049,	0x004A,	0x004B,	0x004C,	0x004D,	0x004E,	0x004F,
	0x0050,	0x0051,	0x0052,	0x0053,	0x0054,	0x0055,	0x0056,	0x0057,	0x0058,	0x0059,	0x005A,	0x005B,	0x005C,	0x005D,	0x005E,	0x005F,
	0x0060,	0x0061,	0x0062,	0x0063,	0x0064,	0x0065,	0x0066,	0x0067,	0x0068,	0x0069,	0x006A,	0x006B,	0x006C,	0x006D,	0x006E,	0x006F,
	0x0070,	0x0071,	0x0072,	0x0073,	0x0074,	0x0075,	0x0076,	0x0077,	0x0078,	0x0079,	0x007A,	0x007B,	0x00A6,	0x007D,	0x007E,	0x2302,
	0x00C7,	0x00FC,	0x00E9,	0x00E2,	0x00E4,	0x00E0,	0x00E5,	0x00E7,	0x00EA,	0x00EB,	0x00E8,	0x00EF,	0x00EE,	0x00EC,	0x00C4,	0x00C5,
	0x00C9,	0x00E6,	0x00C6,	0x00F4,	0x00F6,	0x00F2,	0x00FB,	0x00F9,	0x00FF,	0x00D6,	0x00DC,	0x00A2,	0x00A3,	0x00A5,	0x20A7,	0x0192,
	0x00E1,	0x00ED,	0x00F3,	0x00FA,	0x00F1,	0x00D1,	0x00AA,	0x00BA,	0x00BF,	0x2310,	0x00AC,	0x00BD,	0x00BC,	0x00A1,	0x00AB,	0x00BB,
	0x2591,	0x2592,	0x2593,	0x2502,	0x2524,	0x2561,	0x2562,	0x2556,	0x2555,	0x2563,	0x2551,	0x2557,	0x255D,	0x255C,	0x255B,	0x2510,
	0x2514,	0x2534,	0x252C,	0x251C,	0x2500,	0x253C,	0x255E,	0x255F,	0x255A,	0x2554,	0x2569,	0x2566,	0x2560,	0x2550,	0x256C,	0x2567,
	0x2568,	0x2564,	0x2565,	0x2559,	0x2558,	0x2552,	0x2553,	0x256B,	0x256A,	0x2518,	0x250C,	0x2588,	0x2584,	0x258C,	0x2590,	0x2580,
	0x03B1,	0x00DF,	0x0393,	0x03C0,	0x03A3,	0x03C3,	0x00B5,	0x03C4,	0x03A6,	0x0398,	0x03A9,	0x03B4,	0x221E,	0x03C6,	0x03B5,	0x2229,
	0x2261,	0x00B1,	0x2265,	0x2264,	0x2320,	0x2321,	0x00F7,	0x2248,	0x00B0,	0x2219,	0x00B7,	0x221A,	0x207F,	0x00B2,	0x25A0,	0x25A1
];

/**
 * Parse a .xp (REXPaint) file. Each layer will be returned as a separate slice.
 * @param {File} file
 * @return {Promise<Slice[]>}
 */
async function parseRexPaintFile(file) {
  let unzip = new DecompressionStream("gzip");
  let stream = file.stream().pipeThrough(unzip);
  let blob = await new Response(stream).blob();
  let arrayBuffer = await blob.arrayBuffer();
  let view = new DataView(arrayBuffer);

  /**
   * @type {Slice[]}
   */
  let slices = [];
  let offset = 8;
  let layers = view.getUint32(4, true);

  for (let layer = 0; layer < layers; layer++) {
    let width = view.getInt32(offset + 0, true);
    let height = view.getInt32(offset + 4, true);
    let slice = createEmptySlice({ x: 0, y: 0, w: width, h: height });
    offset += 8;

    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        let code = view.getUint32(offset, true);
        let r0 = view.getUint8(offset + 4);
        let g0 = view.getUint8(offset + 5);
        let b0 = view.getUint8(offset + 6);
        let r1 = view.getUint8(offset + 7);
        let g1 = view.getUint8(offset + 8);
        let b1 = view.getUint8(offset + 9);
        offset += 10;

        let i = x + y * width;
        let fg = `rgb(${r0}, ${g0}, ${b0})`;
        let bg = `rgb(${r1}, ${g1}, ${b1})`;
        let ch = String.fromCharCode(cp437[code]);

        slice.cells[i] = {
          glyph: ch,
          foregroundColor: fg,
          backgroundColor: bg,
        };
      }
    }

    slices.push(slice);
  }

  return slices;
}

/**
 * Parse a .txt file.
 * @param {File} file
 * @return {Promise<Slice>}
 */
async function parseTxtFile(file) {
  let text = await file.text();
  let lines = text.split("\n");
  let height = lines.length;
  let width = Math.max(...lines.map((l) => l.length));
  let bounds = { x: 0, y: 0, w: width, h: height };
  let slice = createEmptySlice(bounds);

  for (let y = 0; y < height; y++) {
    let line = lines[y];
    for (let x = 0; x < width; x++) {
      slice.cells[x + y * width] = {
        glyph: line[x],
        foregroundColor: "white",
        backgroundColor: "",
      };
    }
  }

  return slice;
}

/**
 * @param {App} app
 * @param {"png" | "svg" | "json" | "txt" | "xp"} format
 */
function download(app, format) {
  let a = document.createElement("a");
  a.setAttribute("download", `export.${format}`);
  let href = "";

  if (format === "png") {
    href = renderToPng(app);
  } else if (format === "svg") {
    let svg = renderToSvg(app);
    let blob = new Blob([svg], { type: "image/svg+xml" });
    href = URL.createObjectURL(blob);
  } else if (format === "txt") {
    let txt = renderToText(app);
    let blob = new Blob([txt], { type: "text/plain" });
    href = URL.createObjectURL(blob);
  } else if (format === "json") {
    let text = JSON.stringify(app.snapshot());
    let blob = new Blob([text], { type: "application/json" });
    href = URL.createObjectURL(blob);
  } else if (format === "xp") {
    alert("not supported");
  }

  a.setAttribute("href", href);
  a.click();
}

/**
 * The library of available glyphs in the glyph picker.
 */
const glyphLibrary = {
  ascii: createGlyphRange(0x20, 0x80),
  alphabet: createGlyphRange(0x41, 0x61),
  geometric: [
    ...createGlyphRange(0x25a0, 0x25ff),
    ...createGlyphRange(0x2580, 0x2590),
  ],
  arrows: createGlyphRange(0x2190, 0x21ff),
  math: createGlyphRange(0x2200, 0x22ff),
  misc: createGlyphRange(0x2300, 0x23ff),
  box: createGlyphRange(0x2500, 0x25ff),
};

/**
 * The library of available colors in the color pickers.
 */
// prettier-ignore
const colorLibrary = {
  "transparent": ["transparent"],
  "lospec500": ["#10121c", "#2c1e31", "#6b2643", "#ac2847", "#ec273f", "#94493a", "#de5d3a", "#e98537", "#f3a833", "#4d3533", "#6e4c30", "#a26d3f", "#ce9248", "#dab163", "#e8d282", "#f7f3b7", "#1e4044", "#006554", "#26854c", "#5ab552", "#9de64e", "#008b8b", "#62a477", "#a6cb96", "#d3eed3", "#3e3b65", "#3859b3", "#3388de", "#36c5f4", "#6dead6", "#5e5b8c", "#8c78a5", "#b0a7b8", "#deceed", "#9a4d76", "#c878af", "#cc99ff", "#fa6e79", "#ffa2ac", "#ffd1d5", "#f6e8e0", "#ffffff"],
  "supremo": ["#ece7e1", "#ded5c4", "#e2d053", "#df863a", "#b6472e", "#62221c", "#171618", "#313b52", "#43618a", "#8da6ad", "#6d765e", "#3b5536"],
  "pelennor8": ["#191d1e", "#3f4550", "#70787a", "#c0bfc0", "#eae5e2", "#baaa91", "#877459", "#534b3a"],
  "verdant-deep-woods": ["#000c2c", "#001d37", "#003645", "#005858", "#00755c", "#039a5d", "#15bd5e", "#00d459", "#66f390"],
  "septembit-22": ["#664750", "#bd6859", "#b8be4f", "#ffe082"],
  "septembit-24": ["#d8ffb6", "#053345"],
  "lemondrop": ["#191a1a", "#3c3c4f", "#966982", "#dfddb5", "#06858c", "#12ae5d", "#c0cc29", "#efdf53"],
  "nuclear-fission": ["#ffee00", "#daa100", "#9b4c00", "#5b1200", "#090001"],
  "septembit-2021": ["#2e283f", "#fb2e86", "#fffcf3"],
  "cc-29": ["#f2f0e5", "#b8b5b9", "#868188", "#646365", "#45444f", "#3a3858", "#212123", "#352b42", "#43436a", "#4b80ca", "#68c2d3", "#a2dcc7", "#ede19e", "#d3a068", "#b45252", "#6a536e", "#4b4158", "#80493a", "#a77b5b", "#e5ceb4", "#c2d368", "#8ab060", "#567b79", "#4e584a", "#7b7243", "#b2b47e", "#edc8c4", "#cf8acb", "#5f556a"],
  "resurrect-64": ["#2e222f", "#3e3546", "#625565", "#966c6c", "#ab947a", "#694f62", "#7f708a", "#9babb2", "#c7dcd0", "#ffffff", "#6e2727", "#b33831", "#ea4f36", "#f57d4a", "#ae2334", "#e83b3b", "#fb6b1d", "#f79617", "#f9c22b", "#7a3045", "#9e4539", "#cd683d", "#e6904e", "#fbb954", "#4c3e24", "#676633", "#a2a947", "#d5e04b", "#fbff86", "#165a4c", "#239063", "#1ebc73", "#91db69", "#cddf6c", "#313638", "#374e4a", "#547e64", "#92a984", "#b2ba90", "#0b5e65", "#0b8a8f", "#0eaf9b", "#30e1b9", "#8ff8e2", "#323353", "#484a77", "#4d65b4", "#4d9be6", "#8fd3ff", "#45293f", "#6b3e75", "#905ea9", "#a884f3", "#eaaded", "#753c54", "#a24b6f", "#cf657f", "#ed8099", "#831c5d", "#c32454", "#f04f78", "#f68181", "#fca790", "#fdcbb0"],
  "slso8": ["#0d2b45", "#203c56", "#544e68", "#8d697a", "#d08159", "#ffaa5e", "#ffd4a3", "#ffecd6"],
  "oil-6": ["#fbf5ef", "#f2d3ab", "#c69fa5", "#8b6d9c", "#494d7e", "#272744"],
  "apollo": ["#172038", "#253a5e", "#3c5e8b", "#4f8fba", "#73bed3", "#a4dddb", "#19332d", "#25562e", "#468232", "#75a743", "#a8ca58", "#d0da91", "#4d2b32", "#7a4841", "#ad7757", "#c09473", "#d7b594", "#e7d5b3", "#341c27", "#602c2c", "#884b2b", "#be772b", "#de9e41", "#e8c170", "#241527", "#411d31", "#752438", "#a53030", "#cf573c", "#da863e", "#1e1d39", "#402751", "#7a367b", "#a23e8c", "#c65197", "#df84a5", "#090a14", "#10141f", "#151d28", "#202e37", "#394a50", "#577277", "#819796", "#a8b5b2", "#c7cfcc", "#ebede9"],
  "vinik24": ["#000000", "#6f6776", "#9a9a97", "#c5ccb8", "#8b5580", "#c38890", "#a593a5", "#666092", "#9a4f50", "#c28d75", "#7ca1c0", "#416aa3", "#8d6268", "#be955c", "#68aca9", "#387080", "#6e6962", "#93a167", "#6eaa78", "#557064", "#9d9f7f", "#7e9e99", "#5d6872", "#433455"],
  "twilight-5": ["#fbbbad", "#ee8695", "#4a7a96", "#333f58", "#292831"],
  "fantasy-24": ["#1f240a", "#39571c", "#a58c27", "#efac28", "#efd8a1", "#ab5c1c", "#183f39", "#ef692f", "#efb775", "#a56243", "#773421", "#724113", "#2a1d0d", "#392a1c", "#684c3c", "#927e6a", "#276468", "#ef3a0c", "#45230d", "#3c9f9c", "#9b1a0a", "#36170c", "#550f0a", "#300f0a"],
  "endesga-32": ["#be4a2f", "#d77643", "#ead4aa", "#e4a672", "#b86f50", "#733e39", "#3e2731", "#a22633", "#e43b44", "#f77622", "#feae34", "#fee761", "#63c74d", "#3e8948", "#265c42", "#193c3e", "#124e89", "#0099db", "#2ce8f5", "#ffffff", "#c0cbdc", "#8b9bb4", "#5a6988", "#3a4466", "#262b44", "#181425", "#ff0044", "#68386c", "#b55088", "#f6757a", "#e8b796", "#c28569"],
  "lost-century": ["#d1b187", "#c77b58", "#ae5d40", "#79444a", "#4b3d44", "#ba9158", "#927441", "#4d4539", "#77743b", "#b3a555", "#d2c9a5", "#8caba1", "#4b726e", "#574852", "#847875", "#ab9b8e"],
  "blessing": ["#74569b", "#96fbc7", "#f7ffae", "#ffb3cb", "#d8bfd8"],
  "pear36": ["#5e315b", "#8c3f5d", "#ba6156", "#f2a65e", "#ffe478", "#cfff70", "#8fde5d", "#3ca370", "#3d6e70", "#323e4f", "#322947", "#473b78", "#4b5bab", "#4da6ff", "#66ffe3", "#ffffeb", "#c2c2d1", "#7e7e8f", "#606070", "#43434f", "#272736", "#3e2347", "#57294b", "#964253", "#e36956", "#ffb570", "#ff9166", "#eb564b", "#b0305c", "#73275c", "#422445", "#5a265e", "#80366b", "#bd4882", "#ff6b97", "#ffb5b5"],
  "1bit-monitor-glow": ["#222323", "#f0f6f0"],
  "sweetie-16": ["#1a1c2c", "#5d275d", "#b13e53", "#ef7d57", "#ffcd75", "#a7f070", "#38b764", "#257179", "#29366f", "#3b5dc9", "#41a6f6", "#73eff7", "#f4f4f4", "#94b0c2", "#566c86", "#333c57"],
  "midnight-ablaze": ["#ff8274", "#d53c6a", "#7c183c", "#460e2b", "#31051e", "#1f0510", "#130208"],
  "nyx8": ["#08141e", "#0f2a3f", "#20394f", "#f6d6bd", "#c3a38a", "#997577", "#816271", "#4e495f"],
  "ice-cream-gb": ["#7c3f58", "#eb6b6f", "#f9a875", "#fff6d3"],
  "steam-lords": ["#213b25", "#3a604a", "#4f7754", "#a19f7c", "#77744f", "#775c4f", "#603b3a", "#3b2137", "#170e19", "#2f213b", "#433a60", "#4f5277", "#65738c", "#7c94a1", "#a0b9ba", "#c0d1cc"],
  "lava-gb": ["#051f39", "#4a2480", "#c53a9d", "#ff8e80"],
  "rust-gold-8": ["#f6cd26", "#ac6b26", "#563226", "#331c17", "#bb7f57", "#725956", "#393939", "#202020"],
  "3-bit-rgb": ["#000000", "#ff0000", "#00ff00", "#0000ff", "#00ffff", "#ff00ff", "#ffff00", "#ffffff"],
  "thirty-one": ["#636663", "#87857c", "#bcad9f", "#f2b888", "#eb9661", "#b55945", "#734c44", "#3d3333", "#593e47", "#7a5859", "#a57855", "#de9f47", "#fdd179", "#fee1b8", "#d4c692", "#a6b04f", "#819447", "#44702d", "#2f4d2f", "#546756", "#89a477", "#a4c5af", "#cae6d9", "#f1f6f0", "#d5d6db", "#bbc3d0", "#96a9c1", "#6c81a1", "#405273", "#303843", "#14233a"],
};

// @ts-ignore
// prettier-ignore
window.icons = {
  lock: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-lock"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
}

// @ts-ignore
window.app = app;
