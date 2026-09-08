// Reading-order analysis (columns and paragraphs) for recognised lines,
// carried over verbatim from esearch-ocr 8.5.0 (Apache-2.0, see index.js)
// with the debug logging stubbed out. Not part of the hot path.
/* eslint-disable */
const log = () => {};

function afAfRec(l, op) {
  log(l);
  const dirs = op?.docDirs ?? [
    { block: "tb", inline: "lr" },
    { block: "rl", inline: "tb" }
  ];
  const dir = { block: "tb", inline: "lr" };
  const dirVector = {
    inline: [1, 0],
    block: [0, 1]
  };
  const baseVector = {
    inline: [1, 0],
    block: [0, 1]
  };
  if (l.length === 0) {
    return {
      columns: [],
      parragraphs: [],
      readingDir: dir,
      angle: { reading: { inline: 0, block: 90 }, angle: 0 }
    };
  }
  const colTip = [
    {
      box: [
        [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
        [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
        [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
        [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]
      ],
      type: "none"
    }
  ];
  const defaultColId = 0;
  function findColId(b) {
    const c = Box.center(b);
    for (let id = colTip.length - 1; id >= 0; id--) {
      const item = colTip[id];
      const box = item.box;
      if (c[0] >= box[0][0] && c[0] <= box[1][0] && c[1] >= box[0][1] && c[1] <= box[3][1]) {
        return id;
      }
    }
    return defaultColId;
  }
  const Point = {
    center: (p1, p2) => [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2],
    disByV: (p1, p2, type) => {
      if (type === "block") {
        return Math.abs(Vector.dotMup(p1, baseVector.block) - Vector.dotMup(p2, baseVector.block));
      }
      return Math.abs(Vector.dotMup(p1, baseVector.inline) - Vector.dotMup(p2, baseVector.inline));
    },
    compare: (a, b, type) => {
      if (type === "block") {
        return Vector.dotMup(a, baseVector.block) - Vector.dotMup(b, baseVector.block);
      }
      return Vector.dotMup(a, baseVector.inline) - Vector.dotMup(b, baseVector.inline);
    },
    toInline: (p2) => {
      return Vector.dotMup(p2, baseVector.inline);
    },
    toBlock: (p2) => {
      return Vector.dotMup(p2, baseVector.block);
    }
  };
  const Box = {
    inlineStart: (b) => Point.center(b[0], b[3]),
    inlineEnd: (b) => Point.center(b[1], b[2]),
    blockStart: (b) => Point.center(b[0], b[1]),
    blockEnd: (b) => Point.center(b[2], b[3]),
    inlineSize: (b) => b[1][0] - b[0][0],
    blockSize: (b) => b[3][1] - b[0][1],
    inlineStartDis: (a, b) => Point.disByV(a[0], b[0], "inline"),
    inlineEndDis: (a, b) => Point.disByV(a[1], b[1], "inline"),
    blockGap: (newB, oldB) => Point.disByV(newB[0], oldB[3], "block"),
    inlineCenter: (b) => (b[2][0] + b[0][0]) / 2,
    blockCenter: (b) => (b[2][1] + b[0][1]) / 2,
    inlineStartCenter: (b) => Box.inlineStart(b),
    center: (b) => Point.center(b[0], b[2])
  };
  const Vector = {
    fromPonts: (p1, p2) => [p1[0] - p2[0], p1[1] - p2[1]],
    dotMup: (a, b) => a[0] * b[0] + a[1] * b[1],
    numMup: (a, b) => [a[0] * b, a[1] * b],
    add: (a, b) => [a[0] + b[0], a[1] + b[1]]
  };
  function averLineAngles(a) {
    let iav = 0;
    let n = 0;
    const l2 = [];
    for (const [index, i] of a.entries()) {
      const a1 = i > 180 ? i - 180 : i;
      const a2 = a1 - 180;
      const a3 = index === 0 ? a1 : Math.abs(a2 - iav) < Math.abs(a1 - iav) ? a2 : a1;
      l2.push(a3);
      iav = (iav * n + a3) / (n + 1);
      n++;
    }
    return { av: iav, l: l2 };
  }
  function lineAngleNear(a1, a2) {
    if (Math.abs(a1 - a2) < 45) return true;
    if (Math.abs(a1 - (a2 - 180)) < 45) return true;
    if (Math.abs(a1 - 180 - a2) < 45) return true;
    return false;
  }
  function median(l2) {
    l2.sort((a, b) => a - b);
    const mid = Math.floor(l2.length / 2);
    return l2.length % 2 === 0 ? (l2[mid - 1] + l2[mid]) / 2 : l2[mid];
  }
  function dir2xy(d) {
    if (d === "lr" || d === "rl") return "x";
    return "y";
  }
  function smallest(l2, f) {
    let min = Number.POSITIVE_INFINITY;
    let minIndex = -1;
    for (let i = 0; i < l2.length; i++) {
      const v = f(l2[i]);
      if (v < min) {
        min = v;
        minIndex = i;
      }
    }
    return l2[minIndex];
  }
  const tipV = {
    lr: [1, 0],
    rl: [-1, 0],
    tb: [0, 1],
    bt: [0, -1]
  };
  function transXY(old, target) {
    const oX = tipV[old.inline];
    const oY = tipV[old.block];
    const tX = tipV[target.inline];
    const tY = tipV[target.block];
    const tInOX = [Vector.dotMup(tX, oX), Vector.dotMup(tX, oY)];
    const tInOY = [Vector.dotMup(tY, oX), Vector.dotMup(tY, oY)];
    return (p2) => {
      return [Vector.dotMup(p2, tInOX), Vector.dotMup(p2, tInOY)];
    };
  }
  function transBox(old, target) {
    const t = transXY(old, target);
    return {
      b: (b) => {
        for (const p2 of b) {
          const [a, b2] = t(p2);
          p2[0] = a;
          p2[1] = b2;
        }
      },
      p: t
    };
  }
  function reOrderBox(map) {
    return (b) => {
      const newB = [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0]
      ];
      for (let i = 0; i < map.length; i++) {
        newB[i] = b[map[i]];
      }
      return newB;
    };
  }
  function r(point, point2) {
    return Math.sqrt((point[0] - point2[0]) ** 2 + (point[1] - point2[1]) ** 2);
  }
  function outerRect(boxes) {
    const points = boxes.flatMap((i) => i.map((i2) => i2));
    const x1 = Math.min(...points.map((p2) => Vector.dotMup(p2, baseVector.inline)));
    const x2 = Math.max(...points.map((p2) => Vector.dotMup(p2, baseVector.inline)));
    const y1 = Math.min(...points.map((p2) => Vector.dotMup(p2, baseVector.block)));
    const y2 = Math.max(...points.map((p2) => Vector.dotMup(p2, baseVector.block)));
    const o = Vector.add(Vector.numMup(baseVector.inline, x1), Vector.numMup(baseVector.block, y1));
    const w = Vector.numMup(baseVector.inline, x2 - x1);
    const h = Vector.numMup(baseVector.block, y2 - y1);
    return [o, Vector.add(o, w), Vector.add(Vector.add(o, w), h), Vector.add(o, h)];
  }
  function pushColumn(b) {
    let nearest = null;
    let _jl = Number.POSITIVE_INFINITY;
    for (const i in columns) {
      const last2 = columns[i].src.at(-1);
      if (!last2) continue;
      const jl = r(b.box[0], last2.box[0]);
      if (jl < _jl) {
        nearest = Number(i);
        _jl = jl;
      }
    }
    if (nearest === null) {
      columns.push({ src: [b] });
      return;
    }
    const last = columns[nearest].src.at(-1);
    const thisW = Box.inlineSize(b.box);
    const lastW = Box.inlineSize(last.box);
    const minW = Math.min(thisW, lastW);
    const em = Box.blockSize(b.box);
    if (
      // 左右至少有一边是相近的，中心距离要相近
      // 行之间也不要离太远
      (Box.inlineStartDis(b.box, last.box) < 3 * em || Box.inlineEndDis(b.box, last.box) < 3 * em || Point.disByV(Box.center(b.box), Box.center(last.box), "inline") < minW * 0.4) && Box.blockGap(b.box, last.box) < em * 1.1
    ) {
    } else {
      columns.push({ src: [b] });
      return;
    }
    columns[nearest].src.push(b);
  }
  function joinResult(p2) {
    const cjkv = /\p{Ideographic}/u;
    const cjkf = /[。，！？；：“”‘’《》、【】（）…—]/;
    const res = {
      box: outerRect(p2.map((i) => i.box)),
      text: "",
      mean: average2(p2.map((i) => [i.mean, i.text.length])),
      style: p2[0].style
    };
    for (const i of p2) {
      const lastChar = res.text.at(-1);
      if (lastChar && (!lastChar.match(cjkv) && !lastChar.match(cjkf) || !i.text.at(0)?.match(cjkv) && !i.text.at(0)?.match(cjkf)))
        res.text += " ";
      res.text += i.text;
    }
    return res;
  }
  function sortCol(cs) {
    cs.sort((a, b) => {
      const em = a.src.at(0) ? Box.blockSize(a.src.at(0).box) : 2;
      if (Point.disByV(Box.blockStart(a.outerBox), Box.blockStart(b.outerBox), "block") < em) {
        return Point.compare(Box.inlineStart(a.outerBox), Box.inlineStart(b.outerBox), "inline");
      }
      return Point.compare(Box.blockStart(a.outerBox), Box.blockStart(b.outerBox), "block");
    });
  }
  if (op?.columnsTip) {
    for (const i of op.columnsTip) colTip.push(structuredClone(i));
  }
  const rAngle = {
    inline: 0,
    block: 90
  };
  const inlineAngles = l.map((i) => {
    const b = i.box;
    const w = b[1][0] - b[0][0];
    const h = b[3][1] - b[0][1];
    let v = { x: 0, y: 0 };
    if (w < h) {
      const p2 = Vector.fromPonts(Point.center(b[2], b[3]), Point.center(b[0], b[1]));
      v = { x: p2[0], y: p2[1] };
    } else {
      const p2 = Vector.fromPonts(Point.center(b[1], b[2]), Point.center(b[0], b[3]));
      v = { x: p2[0], y: p2[1] };
    }
    const a = normalAngle(Math.atan2(v.y, v.x) * (180 / Math.PI));
    return a;
  });
  const firstAngleAnalysis = averLineAngles(inlineAngles);
  const filterAngles = inlineAngles.filter((i) => lineAngleNear(i, firstAngleAnalysis.av));
  const md = median(filterAngles);
  const MAD = median(filterAngles.map((i) => Math.abs(i - md)));
  const filterAngles1 = filterAngles.filter((i) => Math.abs((i - md) / (MAD * 1.4826)) < 2);
  const inlineangle = normalAngle(averLineAngles(filterAngles1).av);
  log("dir0", inlineAngles, firstAngleAnalysis, filterAngles, filterAngles1, inlineangle);
  const blockangle = normalAngle(inlineangle + 90);
  const inlineDir = lineAngleNear(inlineangle, 0) ? "x" : "y";
  const blockDir = lineAngleNear(blockangle, 90) ? "y" : "x";
  const fdir = dirs.find((d) => inlineDir === dir2xy(d.inline) && blockDir === dir2xy(d.block)) ?? dirs.at(0);
  if (fdir) {
    dir.block = fdir.block;
    dir.inline = fdir.inline;
  }
  const tipAngle = {
    lr: 0,
    rl: 180,
    tb: 90,
    bt: 270
  };
  rAngle.inline = smallest(
    [inlineangle, inlineangle - 360, inlineangle - 180, inlineangle + 180],
    (a) => Math.abs(a - tipAngle[dir.inline])
  );
  rAngle.block = smallest(
    [blockangle, blockangle - 360, blockangle - 180, blockangle + 180],
    (a) => Math.abs(a - tipAngle[dir.block])
  );
  dirVector.inline = [Math.cos(rAngle.inline * (Math.PI / 180)), Math.sin(rAngle.inline * (Math.PI / 180))];
  dirVector.block = [Math.cos(rAngle.block * (Math.PI / 180)), Math.sin(rAngle.block * (Math.PI / 180))];
  log("dir", dir, rAngle, dirVector, inlineangle, blockangle);
  const reOrderMapX = [
    [dir.inline[0], dir.block[0]],
    [dir.inline[1], dir.block[0]],
    [dir.inline[1], dir.block[1]],
    [dir.inline[0], dir.block[1]]
  ];
  const reOrderMap = reOrderMapX.map(
    ([i, b]) => ({
      lt: 0,
      rt: 1,
      rb: 2,
      lb: 3
    })[i === "l" || i === "r" ? i + b : b + i]
  );
  const xyT = transBox({ inline: "lr", block: "tb" }, dir);
  const reOrderBoxT = reOrderBox(reOrderMap);
  const logicL = l.map((i) => {
    const newBox = reOrderBoxT(i.box);
    xyT.b(newBox);
    return {
      ...i,
      box: newBox
    };
  });
  for (const i of colTip) {
    i.box = reOrderBoxT(i.box);
    xyT.b(i.box);
  }
  baseVector.inline = xyT.p(dirVector.inline);
  baseVector.block = xyT.p(dirVector.block);
  log("\u76F8\u5BF9\u5750\u6807\u7CFB", baseVector);
  const newL_ = logicL.sort((a, b) => Point.compare(Box.blockStart(a.box), Box.blockStart(b.box), "block"));
  const newLZ = [];
  for (const j of newL_) {
    const colId = findColId(j.box);
    const last = newLZ.at(-1)?.line.at(-1);
    if (!last) {
      newLZ.push({ line: [{ src: j, colId }] });
      continue;
    }
    const thisC = Box.center(j.box);
    const lastC = Box.center(last.src.box);
    if (Point.disByV(thisC, lastC, "block") < 0.5 * Box.blockSize(j.box)) {
      const lLast = newLZ.at(-1);
      if (!lLast) {
        newLZ.push({ line: [{ src: j, colId }] });
      } else {
        lLast.line.push({ src: j, colId });
      }
    } else {
      newLZ.push({ line: [{ src: j, colId }] });
    }
  }
  const newL = [];
  for (const l2 of newLZ) {
    if (l2.line.length === 1) {
      newL.push({ src: l2.line[0].src, colId: l2.line[0].colId });
      continue;
    }
    const em = average(l2.line.map((i) => Box.blockSize(i.src.box)));
    l2.line.sort((a, b) => Point.compare(Box.inlineStart(a.src.box), Box.inlineStart(b.src.box), "inline"));
    let last = l2.line.at(0);
    for (const this_ of l2.line.slice(1)) {
      const lastBoxInlineEnd = Box.inlineEnd(last.src.box);
      const thisInlineStart = Box.inlineStart(this_.src.box);
      if (colTip[this_.colId].type === "table" || this_.colId !== last.colId || Point.toInline(thisInlineStart) - Point.toInline(lastBoxInlineEnd) > em) {
        newL.push({ ...last });
        last = this_;
      } else {
        last.src.text += this_.src.text;
        last.src.mean = (last.src.mean + this_.src.mean) / 2;
        last.src.box = outerRect([last.src.box, this_.src.box]);
      }
    }
    newL.push({ ...last });
  }
  const columns = [];
  const defaultNewL = [];
  const noDefaultColumns = [];
  for (const l2 of newL) {
    if (l2.colId === defaultColId) {
      defaultNewL.push(l2);
    } else {
      const col = noDefaultColumns.find((i) => i.colId === l2.colId);
      if (col) {
        col.src.push(l2.src);
      } else {
        noDefaultColumns.push({ src: [l2.src], type: colTip[l2.colId].type, colId: l2.colId });
      }
    }
  }
  defaultNewL.sort((a, b) => Point.compare(Box.blockStart(a.src.box), Box.blockStart(b.src.box), "block"));
  for (const b of defaultNewL) {
    pushColumn(b.src);
  }
  const columnsInYaxis = [];
  for (const [i, col] of columns.entries()) {
    const c = col.src;
    const outer = outerRect(c.map((b) => b.box));
    const x2 = Box.blockCenter(outer);
    const w = Box.inlineSize(outer);
    if (i === 0) {
      columnsInYaxis.push({ smallCol: [{ src: c, outerBox: outer, x: x2, w }] });
      continue;
    }
    const l2 = columnsInYaxis.find((oc) => {
      const r2 = oc.smallCol.at(-1);
      const em = Box.blockSize(c.at(0).box);
      if (Box.inlineStartDis(r2.outerBox, outer) < 3 * em && Box.inlineEndDis(r2.outerBox, outer) < 3 * em && Box.blockGap(outer, r2.outerBox) < em * 2.1)
        return true;
      return false;
    });
    if (l2) {
      l2.smallCol.push({ src: c, outerBox: outer, x: x2, w });
    } else {
      columnsInYaxis.push({ smallCol: [{ src: c, outerBox: outer, x: x2, w }] });
    }
  }
  for (const y of columnsInYaxis) {
    y.smallCol.sort((a, b) => Point.compare(Box.blockStart(a.outerBox), Box.blockStart(b.outerBox), "block"));
  }
  for (const c of noDefaultColumns) {
    c.src.sort((a, b) => Point.compare(Box.blockStart(a.box), Box.blockStart(b.box), "block"));
  }
  const newColumns = [];
  for (const c of columnsInYaxis) {
    const o = outerRect(c.smallCol.map((i) => i.outerBox));
    const s = c.smallCol.flatMap((i) => i.src);
    newColumns.push({ src: s, outerBox: o, type: "none" });
  }
  sortCol(newColumns);
  const mergedColumns = [];
  for (const c of newColumns) {
    const last = mergedColumns.at(-1);
    if (!last) {
      mergedColumns.push(c);
      continue;
    }
    if (last.type !== "none") {
      mergedColumns.push(c);
      continue;
    }
    const lastOuter = last.outerBox;
    const em = Box.blockSize(c.src[0].box);
    if (last.src.length === 1 && Box.inlineStartDis(lastOuter, c.outerBox) < 3 * em || // 标题
    c.src.length === 1 && Box.inlineStartDis(lastOuter, c.outerBox) < 3 * em || // 末尾
    Box.inlineStartDis(lastOuter, c.outerBox) < 3 * em && Box.inlineEndDis(lastOuter, c.outerBox) < 3 * em) {
      last.src.push(...c.src);
      last.outerBox = outerRect(last.src.map((i) => i.box));
    } else {
      mergedColumns.push(c);
    }
  }
  let sortedColChanged = false;
  const mergedColumns2 = [];
  for (const _c of mergedColumns) {
    const last = mergedColumns2.at(-1);
    const c = { ..._c, reCal: false };
    if (!last) {
      mergedColumns2.push(c);
      continue;
    }
    const em = Box.blockSize(c.src.at(0).box);
    if (Point.compare(Box.blockEnd(c.outerBox), Box.blockEnd(last.outerBox), "block") < 0 && (Box.inlineStartDis(last.outerBox, c.outerBox) < 3 * em || Box.inlineEndDis(last.outerBox, c.outerBox) < 3 * em)) {
      last.src.push(...c.src);
      last.reCal = true;
      sortedColChanged = true;
    } else {
      mergedColumns2.push(c);
    }
  }
  for (const c of mergedColumns2) {
    if (!c.reCal) continue;
    c.src.sort((a, b) => Point.compare(Box.blockStart(a.box), Box.blockStart(b.box), "block"));
    c.outerBox = outerRect(c.src.map((i) => i.box));
  }
  if (noDefaultColumns.length) sortedColChanged = true;
  for (const c of noDefaultColumns) {
    const o = outerRect(c.src.map((i) => i.box));
    const s = c.src;
    mergedColumns2.push({ src: s, outerBox: o, type: c.type, reCal: false });
  }
  if (sortedColChanged) sortCol(mergedColumns2);
  const rexyT = transBox(dir, { inline: "lr", block: "tb" });
  const p = mergedColumns2.map((col) => {
    const c = col.src;
    const ps = [];
    if (col.type === "auto" || col.type === "none") {
      const distanceCounts = {};
      for (let i = 1; i < c.length; i++) {
        const b1 = c[i - 1].box;
        const b2 = c[i].box;
        const dis = Point.disByV(Box.center(b2), Box.center(b1), "block");
        if (!distanceCounts[dis]) distanceCounts[dis] = 0;
        distanceCounts[dis]++;
      }
      const avgLineHeight = average(c.map((i) => Box.blockSize(i.box)));
      const distanceGroup = [[]];
      for (const d2 of Object.keys(distanceCounts).map((i) => Number(i)).sort()) {
        const lastG = distanceGroup.at(-1);
        const lastI = lastG.at(-1);
        if (lastI !== void 0) {
          if (Math.abs(lastI - d2) < avgLineHeight * 0.5) {
            lastG.push(d2);
          } else {
            distanceGroup.push([]);
          }
        } else {
          lastG.push(d2);
        }
      }
      const d = distanceGroup.map((g) => average(g)).sort((a, b) => a - b).at(0) || 0;
      log("d", distanceCounts, distanceGroup, d);
      ps.push([c[0]]);
      let lastPara = c[0];
      for (let i = 1; i < c.length; i++) {
        const expect = Vector.add(
          Vector.add(Box.inlineStartCenter(lastPara.box), Vector.numMup(baseVector.block, d)),
          Vector.numMup(baseVector.inline, -Box.inlineStartDis(lastPara.box, col.outerBox))
        );
        const thisLeftCenter = Box.inlineStartCenter(c[i].box);
        const em = Box.blockSize(c[i].box);
        if (Box.inlineEndDis(lastPara.box, col.outerBox) > 2 * em || r(expect, thisLeftCenter) > em * 0.5) {
          ps.push([c[i]]);
        } else {
          const last = ps.at(-1);
          if (!last) ps.push([c[i]]);
          else last.push(c[i]);
        }
        lastPara = c[i];
      }
    } else if (col.type === "table") {
      ps.push(c);
    } else if (col.type === "raw") {
      ps.push(c);
    } else if (col.type === "raw-blank") {
      ps.push(c);
    }
    for (const x2 of c) rexyT.b(x2.box);
    rexyT.b(col.outerBox);
    const backOrderMap = [];
    for (const [i, j] of reOrderMap.entries()) {
      backOrderMap[j] = i;
    }
    const backOrder = reOrderBox(backOrderMap);
    for (const x2 of c) {
      x2.box = backOrder(x2.box);
    }
    col.outerBox = backOrder(col.outerBox);
    log(ps);
    return {
      src: c,
      outerBox: col.outerBox,
      parragraphs: ps.map((p2) => ({ src: p2, parse: joinResult(p2) }))
    };
  });
  const pss = p.flatMap((v) => v.parragraphs.map((p2) => p2.parse));
  let angle = 0;
  if (dir.inline === "lr") {
    angle = rAngle.inline;
  }
  if (dir.inline === "rl") {
    angle = rAngle.inline - 180;
  }
  if (dir.block === "lr") {
    angle = rAngle.block;
  }
  if (dir.block === "rl") {
    angle = rAngle.block - 180;
  }
  log("angle", angle);
  return {
    columns: p,
    parragraphs: pss,
    readingDir: dir,
    angle: { reading: rAngle, angle }
  };
}
function average(args) {
  return args.reduce((a, b) => a + b, 0) / args.length;
}
function average2(args) {
  const xsum = args.map((i) => i[1]).reduce((a, b) => a + b, 0);
  let n = 0;
  for (const i of args) {
    n += i[0] * i[1] / xsum;
  }
  return n;
}
function normalAngle(angle) {
  return (angle % 360 + 360) % 360;
}

module.exports = { afAfRec };
