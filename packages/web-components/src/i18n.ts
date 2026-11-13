export interface ToolbarI18nMessages {
  select: string;
  hand: string;
  rect: string;
  square: string;
  ellipse: string;
  circle: string;
  diamond: string;
  triangle: string;
  polygon: string;
  pentagon: string;
  hexagon: string;
  octagon: string;
  cross: string;
  chevron: string;
  brace: string;
  /** Nome acessível da toolbar. */
  toolbarLabel: string;
  /** Nome acessível de cada área da ilha vertical, separada por divisores. */
  islandAreas: { control: string; shapes: string; properties: string };
  /** Nome do botão e do painel de propriedades da seleção. */
  properties: string;
  /** Dica do botão de propriedades desabilitado. */
  propertiesUnavailable: string;
  /** Nome do grupo de figuras: título da ilha e do botão. */
  figures: string;
  sticky: string;
  stickyColor: string;
  stickyColorYellow: string;
  stickyColorPink: string;
  stickyColorGreen: string;
  stickyColorBlue: string;
  stickyColorOrange: string;
  stickyColorPurple: string;
  stickyColorCustom: string;
  pen: string;
  /** Nome do grupo de desenho: título da ilha e do botão. */
  draw: string;
  /** Nome da opção que cria traços à mão livre na ilha de desenho. */
  drawPen: string;
  /** Nome acessível do botão do grupo de desenho, com a opção que um clique ativa. */
  drawCurrent: (name: string) => string;
  penSettings: string;
  penKind: string;
  penKindPen: string;
  penKindMarker: string;
  penKindHighlighter: string;
  penWidth: string;
  penWidthThin: string;
  penWidthMedium: string;
  penWidthThick: string;
  penColor: string;
  penColorGraphite: string;
  penColorRed: string;
  penColorOrange: string;
  penColorYellow: string;
  penColorGreen: string;
  penColorBlue: string;
  penColorPurple: string;
  penColorPink: string;
  penColorCustom: string;
  eraser: string;
  eraserSize: string;
  eraserThin: string;
  eraserMedium: string;
  eraserThick: string;
  /** Nome acessível do botão do grupo de figuras, com a figura que um clique ativa. */
  figuresCurrent: (name: string) => string;
  line: string;
  bezier: string;
  arrow: string;
  text: string;
  /** Nome do botão que cria boards: as áreas com título que organizam o canvas. */
  board: string;
  undo: string;
  redo: string;
  zoomOut: string;
  zoomIn: string;
  zoomReset: string;
  zoomLabel: string;
}

export interface LayersI18nMessages {
  title: string;
  empty: string;
  objectsLabel: string;
  /** Dica do cadeado de um nó que outro participante está editando. */
  lockedBy: (name: string) => string;
  layerUp: string;
  layerDown: string;
  layerVisible: string;
  layerHidden: string;
  layerLock: string;
  layerUnlock: string;
  nodeUp: string;
  nodeDown: string;
  nodeVisible: string;
  nodeHidden: string;
  nodeLock: string;
  nodeUnlock: string;
}

export interface PropertiesI18nMessages {
  title: string;
  noSelection: string;
  /** Linha que avisa que outro participante detém a seleção e os campos estão desabilitados. */
  lockedBy: (name: string) => string;
  multipleSelection: string;
  sectionTransform: string;
  sectionStyle: string;
  sectionText: string;
  sectionSticky: string;
  stickyColor: string;
  stickyColorYellow: string;
  stickyColorPink: string;
  stickyColorGreen: string;
  stickyColorBlue: string;
  stickyColorOrange: string;
  stickyColorPurple: string;
  stickyColorCustom: string;
  sectionInk: string;
  inkStrokes: (count: number) => string;
  inkColor: string;
  /** Seção do texto dentro das formas fechadas. */
  sectionLabel: string;
  labelVerticalAlign: string;
  labelTop: string;
  labelMiddle: string;
  labelBottom: string;
  labelAlign: string;
  labelAlignLeft: string;
  labelAlignCenter: string;
  labelAlignRight: string;
  labelBold: string;
  labelColor: string;
  labelColorAuto: string;
  /** Seção do board: título, fundo, opacidade do fundo e borda. */
  sectionBoard: string;
  boardTitle: string;
  boardBackground: string;
  boardBackgroundOpacity: string;
  boardBorder: string;
  /** O botão que tira a cor do fundo ou da borda do board. */
  boardNone: string;
  sectionArrange: string;
  mixed: string;
  bringToFront: string;
  sendToBack: string;
  bringForward: string;
  sendBackward: string;
  delete: string;
  posX: string;
  posY: string;
  width: string;
  height: string;
  rotation: string;
  fill: string;
  stroke: string;
  strokeWidth: string;
  opacity: string;
  textContent: string;
  fontSize: string;
  fontSizeAuto: string;
  convertToRectangle: string;
  convertToSquare: string;
  convertToEllipse: string;
  convertToCircle: string;
  triangleVariant: string;
  triangleIsosceles: string;
  triangleEquilateral: string;
  triangleRight: string;
  triangleScalene: string;
  triangleApex: string;
  polygonSides: string;
  crossArmRatio: string;
  chevronDirection: string;
  directionRight: string;
  directionLeft: string;
  directionUp: string;
  directionDown: string;
  chevronNotchDepth: string;
  braceOrientation: string;
  braceTipPosition: string;
  braceCurvature: string;
  bezierSymmetric: string;
}

export interface CanvasI18nMessages {
  announceNoSelection: string;
  announceSingleSelection: (type: string, id: string) => string;
  announceMultiSelection: (count: number) => string;
  announceTool: (tool: string) => string;
  announceZoom: (zoomPercent: number) => string;
  /** O título do board novo, com N o menor número livre: "Board 1", "Board 2"... */
  boardDefaultTitle: (n: number) => string;
  /** O rótulo do campo de edição do título do board. */
  boardTitleLabel: string;
  /** O anúncio ao selecionar um board, com o título dele. */
  announceBoardSelection: (title: string) => string;
}

/** Textos de `<canvas-controls>`: histórico e menu de zoom. */
export interface CanvasControlsI18nMessages {
  /** Nome do grupo de desfazer e refazer. */
  historyLabel: string;
  undo: string;
  redo: string;
  /** Nome acessível do botão que mostra o zoom atual e abre o menu. */
  zoomButton: (zoomPercent: number) => string;
  zoomMenu: string;
  zoomIn: string;
  zoomOut: string;
  zoomTo100: string;
  zoomToFit: string;
  zoomToSelection: string;
  /** Nome acessível do botão "?" que abre o diálogo de atalhos. */
  help: string;
  helpTitle: string;
  close: string;
  helpSectionEdit: string;
  helpSectionArrange: string;
  helpSectionView: string;
  helpDelete: string;
  helpEditText: string;
  helpMove: string;
  helpUndo: string;
  helpRedo: string;
  helpCancel: string;
  helpGroup: string;
  helpUngroup: string;
  helpBringToFront: string;
  helpBringForward: string;
  helpSendBackward: string;
  helpSendToBack: string;
  helpPan: string;
  keySpace: string;
}

/** Textos de `<canvas-selection-menu>`: o mini-menu da seleção e o painel de propriedades. */
export interface SelectionMenuI18nMessages {
  /** Nome da barra de ações da seleção. */
  toolbarLabel: string;
  bringToFront: string;
  sendToBack: string;
  group: string;
  ungroup: string;
  delete: string;
  /** Botão que exporta o board selecionado (também o `title` dele). */
  exportBoard: string;
  /** Nome do submenu com os formatos da exportação do board. */
  exportBoardMenu: string;
  exportBoardSvg: string;
  exportBoardPng: string;
}

/** Textos de `<canvas-section>`. */
export interface ShellI18nMessages {
  /** Nome acessível do botão hambúrguer. */
  menu: string;
  /** Nome acessível do título do projeto, que abre a edição. */
  editTitle: (title: string) => string;
  /** Título mostrado quando o projeto não tem nome. */
  untitled: string;
  /** Nome acessível do campo de edição do título. */
  titleInput: string;
  /** Rótulo da pill que pede o compartilhamento (`share-request`). */
  share: string;
  /** Nome acessível da pill com a colaboração conectando. O rótulo visível não muda. */
  shareConnecting: string;
  /** Nome acessível da pill com a colaboração ativa. */
  shareActive: string;
  /** Aviso do host quando a colaboração não conectou. */
  shareFailed: string;
  /** Item que pede para parar de compartilhar (`share-stop`). */
  shareStop: string;
  /** Nome acessível da pilha de avatares: quantas outras pessoas estão na sessão. */
  participants: (others: number) => string;
  /** Título da ilha de participantes: quantas pessoas, a local incluída. */
  inSession: (total: number) => string;
  /** Marca a pessoa local na lista da ilha. */
  you: string;
  /** Botão que pede para seguir a pessoa. */
  follow: string;
  /** Botão da pessoa que já está sendo seguida. */
  following: string;
  /** Nome acessível da ilha de participantes (`role="dialog"`). */
  participantsDialog: string;
  /** Texto da faixa enquanto a pessoa segue alguém. */
  followingBanner: (name: string) => string;
  /** Botão da faixa que para de seguir. */
  stopFollowing: string;
  /** Aviso do host quando a pessoa seguida sai da sessão. */
  followLeft: (name: string) => string;
  /** Título do botão Seguir de quem não publica a vista. */
  followUnsupported: string;
  /** Aviso do host quando há alterações pendentes e o compartilhamento continua ativo. */
  shareStopPending: string;
  /** Rótulo da pill que abre a ilha de exportação. */
  export: string;
  /** Nome acessível da ilha de exportação (`role="menu"`). */
  exportMenu: string;
  exportSvg: string;
  exportPng: string;
  /** Nome acessível do avatar do usuário. */
  account: (name: string) => string;
}

export interface CanvashI18nMessages {
  toolbar: ToolbarI18nMessages;
  layers: LayersI18nMessages;
  properties: PropertiesI18nMessages;
  canvas: CanvasI18nMessages;
  controls: CanvasControlsI18nMessages;
  shell: ShellI18nMessages;
  selectionMenu: SelectionMenuI18nMessages;
}

export const defaultI18nPtBR: CanvashI18nMessages = {
  toolbar: {
    select: 'Selecionar (V)',
    hand: 'Mão',
    rect: 'Retângulo (R)',
    square: 'Quadrado',
    ellipse: 'Elipse (O)',
    circle: 'Círculo',
    diamond: 'Losango',
    triangle: 'Triângulo',
    polygon: 'Polígono',
    pentagon: 'Pentágono',
    hexagon: 'Hexágono',
    octagon: 'Octógono',
    cross: 'Cruz',
    chevron: 'Chevron',
    brace: 'Chaves',
    toolbarLabel: 'Ferramentas do canvas',
    islandAreas: { control: 'Controle', shapes: 'Formas', properties: 'Propriedades' },
    properties: 'Propriedades',
    propertiesUnavailable: 'Selecione uma ou mais formas',
    figures: 'Figuras',
    sticky: 'Nota adesiva',
    stickyColor: 'Cor da nota',
    stickyColorYellow: 'Amarelo',
    stickyColorPink: 'Rosa',
    stickyColorGreen: 'Verde',
    stickyColorBlue: 'Azul',
    stickyColorOrange: 'Laranja',
    stickyColorPurple: 'Roxo',
    stickyColorCustom: 'Personalizada',
    pen: 'Caneta',
    draw: 'Desenho',
    drawPen: 'Tinta',
    drawCurrent: (name) => `Desenho: ${name}`,
    penSettings: 'Configurações da caneta',
    penKind: 'Tipo',
    penKindPen: 'Caneta',
    penKindMarker: 'Marcador',
    penKindHighlighter: 'Marca-texto',
    penWidth: 'Espessura',
    penWidthThin: 'Fina',
    penWidthMedium: 'Média',
    penWidthThick: 'Grossa',
    penColor: 'Cor',
    penColorGraphite: 'Grafite',
    penColorRed: 'Vermelho',
    penColorOrange: 'Laranja',
    penColorYellow: 'Amarelo',
    penColorGreen: 'Verde',
    penColorBlue: 'Azul',
    penColorPurple: 'Roxo',
    penColorPink: 'Rosa',
    penColorCustom: 'Personalizada',
    eraser: 'Borracha',
    eraserSize: 'Tamanho da borracha',
    eraserThin: 'Fina',
    eraserMedium: 'Média',
    eraserThick: 'Grossa',
    figuresCurrent: (name) => `Figuras: ${name}`,
    line: 'Linha (L)',
    bezier: 'Bézier',
    arrow: 'Seta (A)',
    text: 'Texto (T)',
    board: 'Board',
    undo: 'Desfazer (Ctrl+Z)',
    redo: 'Refazer (Ctrl+Y)',
    zoomOut: 'Diminuir zoom',
    zoomIn: 'Aumentar zoom',
    zoomReset: 'Ajustar zoom para 100%',
    zoomLabel: 'Nível de zoom atual',
  },
  layers: {
    title: 'Camadas',
    empty: 'Vazia',
    objectsLabel: 'Objetos da camada',
    lockedBy: (name) => `Em edição por ${name}`,
    layerUp: 'Mover camada para cima',
    layerDown: 'Mover camada para baixo',
    layerVisible: 'Exibir camada',
    layerHidden: 'Ocultar camada',
    layerLock: 'Bloquear camada',
    layerUnlock: 'Desbloquear camada',
    nodeUp: 'Trazer para a frente',
    nodeDown: 'Enviar para trás',
    nodeVisible: 'Exibir objeto',
    nodeHidden: 'Ocultar objeto',
    nodeLock: 'Bloquear objeto',
    nodeUnlock: 'Desbloquear objeto',
  },
  properties: {
    title: 'Propriedades',
    noSelection: 'Nenhum objeto selecionado',
    lockedBy: (name) => `Em edição por ${name}`,
    multipleSelection: 'Múltiplos objetos selecionados',
    sectionTransform: 'Dimensões & Posição',
    sectionStyle: 'Aparência',
    sectionText: 'Texto',
    sectionSticky: 'Nota adesiva',
    stickyColor: 'Cor da nota',
    stickyColorYellow: 'Amarelo',
    stickyColorPink: 'Rosa',
    stickyColorGreen: 'Verde',
    stickyColorBlue: 'Azul',
    stickyColorOrange: 'Laranja',
    stickyColorPurple: 'Roxo',
    stickyColorCustom: 'Personalizada',
    sectionInk: 'Caneta',
    inkStrokes: (count) => (count === 1 ? '1 traço' : `${count} traços`),
    inkColor: 'Cor dos traços',
    sectionLabel: 'Texto na forma',
    labelVerticalAlign: 'Posição',
    labelTop: 'Topo',
    labelMiddle: 'Centro',
    labelBottom: 'Base',
    labelAlign: 'Alinhamento',
    labelAlignLeft: 'Esquerda',
    labelAlignCenter: 'Centro',
    labelAlignRight: 'Direita',
    labelBold: 'Negrito',
    labelColor: 'Cor do texto',
    labelColorAuto: 'Automática',
    sectionBoard: 'Board',
    boardTitle: 'Título',
    boardBackground: 'Fundo',
    boardBackgroundOpacity: 'Opacidade do fundo',
    boardBorder: 'Borda',
    boardNone: 'Nenhum',
    sectionArrange: 'Organizar',
    mixed: 'Misto',
    bringToFront: 'Trazer para frente',
    sendToBack: 'Enviar para trás',
    bringForward: 'Avançar um nível',
    sendBackward: 'Recuar um nível',
    delete: 'Excluir objeto',
    posX: 'Posição X',
    posY: 'Posição Y',
    width: 'Largura',
    height: 'Altura',
    rotation: 'Rotação',
    fill: 'Preenchimento',
    stroke: 'Contorno',
    strokeWidth: 'Espessura',
    opacity: 'Opacidade',
    textContent: 'Conteúdo do texto',
    fontSize: 'Tamanho da fonte',
    fontSizeAuto: 'Automático',
    convertToRectangle: 'Converter para Retângulo',
    convertToSquare: 'Converter para Quadrado',
    convertToEllipse: 'Converter para Elipse',
    convertToCircle: 'Converter para Círculo',
    triangleVariant: 'Variante',
    triangleIsosceles: 'Isósceles',
    triangleEquilateral: 'Equilátero',
    triangleRight: 'Retângulo',
    triangleScalene: 'Escaleno',
    triangleApex: 'Ápice',
    polygonSides: 'Lados',
    crossArmRatio: 'Espessura dos braços',
    chevronDirection: 'Direção',
    directionRight: 'Direita',
    directionLeft: 'Esquerda',
    directionUp: 'Cima',
    directionDown: 'Baixo',
    chevronNotchDepth: 'Profundidade da ponta',
    braceOrientation: 'Orientação',
    braceTipPosition: 'Posição da ponta',
    braceCurvature: 'Curvatura',
    bezierSymmetric: 'Simétrica',
  },
  canvas: {
    announceNoSelection: 'Nenhum objeto selecionado',
    announceSingleSelection: (type, id) => `Objeto ${type} selecionado (${id})`,
    announceMultiSelection: (count) => `${count} objetos selecionados`,
    announceTool: (tool) => `Ferramenta ${tool} ativada`,
    announceZoom: (zoomPercent) => `Zoom alterado para ${zoomPercent}%`,
    boardDefaultTitle: (n) => `Board ${n}`,
    boardTitleLabel: 'Título do board',
    announceBoardSelection: (title) => `Board ${title} selecionado`,
  },
  controls: {
    historyLabel: 'Histórico',
    undo: 'Desfazer',
    redo: 'Refazer',
    zoomButton: (zoomPercent) => `Zoom: ${zoomPercent}%`,
    zoomMenu: 'Opções de zoom',
    zoomIn: 'Aproximar',
    zoomOut: 'Afastar',
    zoomTo100: 'Zoom em 100%',
    zoomToFit: 'Ajustar ao conteúdo',
    zoomToSelection: 'Ajustar à seleção',
    help: 'Ajuda e atalhos',
    helpTitle: 'Atalhos de teclado',
    close: 'Fechar',
    helpSectionEdit: 'Edição',
    helpSectionArrange: 'Organização',
    helpSectionView: 'Visão',
    helpDelete: 'Excluir a seleção',
    helpEditText: 'Editar o texto da forma',
    helpMove: 'Mover a seleção (com Shift, 10 px)',
    helpUndo: 'Desfazer',
    helpRedo: 'Refazer',
    helpCancel: 'Cancelar o gesto em andamento',
    helpGroup: 'Agrupar',
    helpUngroup: 'Desagrupar',
    helpBringToFront: 'Trazer para a frente',
    helpBringForward: 'Avançar um nível',
    helpSendBackward: 'Recuar um nível',
    helpSendToBack: 'Enviar para trás',
    helpPan: 'Mover a visão (segurar e arrastar)',
    keySpace: 'Espaço',
  },
  shell: {
    menu: 'Menu',
    editTitle: (title) => `Editar título: ${title}`,
    untitled: 'Sem título',
    titleInput: 'Título do projeto',
    share: 'Compartilhar',
    shareConnecting: 'Compartilhar, conectando',
    shareActive: 'Compartilhar, ativo',
    shareFailed: 'Não foi possível compartilhar',
    shareStop: 'Parar compartilhamento',
    participants: (others) =>
      `Participantes: ${others} ${others === 1 ? 'outra pessoa' : 'outras pessoas'} na sessão`,
    inSession: (total) => `Na sessão (${total})`,
    you: '(você)',
    follow: 'Seguir',
    following: 'Seguindo',
    participantsDialog: 'Participantes',
    followingBanner: (name) => `Seguindo ${name}`,
    stopFollowing: 'Parar',
    followLeft: (name) => `${name} saiu; você parou de seguir`,
    followUnsupported: 'Versão sem suporte a seguir',
    shareStopPending: 'Há alterações pendentes; o compartilhamento continua ativo',
    export: 'Exportar',
    exportMenu: 'Opções de exportação',
    exportSvg: 'Exportar SVG',
    exportPng: 'Exportar PNG',
    account: (name) => `Conta: ${name}`,
  },
  selectionMenu: {
    toolbarLabel: 'Ações da seleção',
    bringToFront: 'Trazer para frente',
    sendToBack: 'Enviar para trás',
    group: 'Agrupar',
    ungroup: 'Desagrupar',
    delete: 'Excluir',
    exportBoard: 'Exportar board',
    exportBoardMenu: 'Opções de exportação do board',
    exportBoardSvg: 'Exportar board como SVG',
    exportBoardPng: 'Exportar board como PNG',
  },
};

export const defaultI18nEnUS: CanvashI18nMessages = {
  toolbar: {
    select: 'Select (V)',
    hand: 'Hand',
    rect: 'Rectangle (R)',
    square: 'Square',
    ellipse: 'Ellipse (O)',
    circle: 'Circle',
    diamond: 'Diamond',
    triangle: 'Triangle',
    polygon: 'Polygon',
    pentagon: 'Pentagon',
    hexagon: 'Hexagon',
    octagon: 'Octagon',
    cross: 'Cross',
    chevron: 'Chevron',
    brace: 'Brace',
    toolbarLabel: 'Canvas tools',
    islandAreas: { control: 'Controls', shapes: 'Shapes', properties: 'Properties' },
    properties: 'Properties',
    propertiesUnavailable: 'Select one or more shapes',
    figures: 'Shapes',
    sticky: 'Sticky note',
    stickyColor: 'Note color',
    stickyColorYellow: 'Yellow',
    stickyColorPink: 'Pink',
    stickyColorGreen: 'Green',
    stickyColorBlue: 'Blue',
    stickyColorOrange: 'Orange',
    stickyColorPurple: 'Purple',
    stickyColorCustom: 'Custom',
    pen: 'Pen',
    draw: 'Draw',
    drawPen: 'Ink',
    drawCurrent: (name) => `Draw: ${name}`,
    penSettings: 'Pen settings',
    penKind: 'Type',
    penKindPen: 'Pen',
    penKindMarker: 'Marker',
    penKindHighlighter: 'Highlighter',
    penWidth: 'Thickness',
    penWidthThin: 'Thin',
    penWidthMedium: 'Medium',
    penWidthThick: 'Thick',
    penColor: 'Color',
    penColorGraphite: 'Graphite',
    penColorRed: 'Red',
    penColorOrange: 'Orange',
    penColorYellow: 'Yellow',
    penColorGreen: 'Green',
    penColorBlue: 'Blue',
    penColorPurple: 'Purple',
    penColorPink: 'Pink',
    penColorCustom: 'Custom',
    eraser: 'Eraser',
    eraserSize: 'Eraser size',
    eraserThin: 'Thin',
    eraserMedium: 'Medium',
    eraserThick: 'Thick',
    figuresCurrent: (name) => `Shapes: ${name}`,
    line: 'Line (L)',
    bezier: 'Bézier',
    arrow: 'Arrow (A)',
    text: 'Text (T)',
    board: 'Board',
    undo: 'Undo (Ctrl+Z)',
    redo: 'Redo (Ctrl+Y)',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    zoomReset: 'Reset zoom to 100%',
    zoomLabel: 'Current zoom level',
  },
  layers: {
    title: 'Layers',
    empty: 'Empty',
    objectsLabel: 'Layer objects',
    lockedBy: (name) => `Being edited by ${name}`,
    layerUp: 'Move layer up',
    layerDown: 'Move layer down',
    layerVisible: 'Show layer',
    layerHidden: 'Hide layer',
    layerLock: 'Lock layer',
    layerUnlock: 'Unlock layer',
    nodeUp: 'Bring to front',
    nodeDown: 'Send to back',
    nodeVisible: 'Show object',
    nodeHidden: 'Hide object',
    nodeLock: 'Lock object',
    nodeUnlock: 'Unlock object',
  },
  properties: {
    title: 'Properties',
    noSelection: 'No object selected',
    lockedBy: (name) => `Being edited by ${name}`,
    multipleSelection: 'Multiple objects selected',
    sectionTransform: 'Transform',
    sectionStyle: 'Appearance',
    sectionText: 'Text',
    sectionSticky: 'Sticky note',
    stickyColor: 'Note color',
    stickyColorYellow: 'Yellow',
    stickyColorPink: 'Pink',
    stickyColorGreen: 'Green',
    stickyColorBlue: 'Blue',
    stickyColorOrange: 'Orange',
    stickyColorPurple: 'Purple',
    stickyColorCustom: 'Custom',
    sectionInk: 'Pen',
    inkStrokes: (count) => (count === 1 ? '1 stroke' : `${count} strokes`),
    inkColor: 'Stroke color',
    sectionLabel: 'Text in shape',
    labelVerticalAlign: 'Position',
    labelTop: 'Top',
    labelMiddle: 'Middle',
    labelBottom: 'Bottom',
    labelAlign: 'Alignment',
    labelAlignLeft: 'Left',
    labelAlignCenter: 'Center',
    labelAlignRight: 'Right',
    labelBold: 'Bold',
    labelColor: 'Text color',
    labelColorAuto: 'Automatic',
    sectionBoard: 'Board',
    boardTitle: 'Title',
    boardBackground: 'Background',
    boardBackgroundOpacity: 'Background opacity',
    boardBorder: 'Border',
    boardNone: 'None',
    sectionArrange: 'Arrange',
    mixed: 'Mixed',
    bringToFront: 'Bring to front',
    sendToBack: 'Send to back',
    bringForward: 'Bring forward',
    sendBackward: 'Send backward',
    delete: 'Delete object',
    posX: 'Position X',
    posY: 'Position Y',
    width: 'Width',
    height: 'Height',
    rotation: 'Rotation',
    fill: 'Fill',
    stroke: 'Stroke',
    strokeWidth: 'Stroke Width',
    opacity: 'Opacity',
    textContent: 'Text content',
    fontSize: 'Font size',
    fontSizeAuto: 'Automatic',
    convertToRectangle: 'Convert to Rectangle',
    convertToSquare: 'Convert to Square',
    convertToEllipse: 'Convert to Ellipse',
    convertToCircle: 'Convert to Circle',
    triangleVariant: 'Variant',
    triangleIsosceles: 'Isosceles',
    triangleEquilateral: 'Equilateral',
    triangleRight: 'Right',
    triangleScalene: 'Scalene',
    triangleApex: 'Apex',
    polygonSides: 'Sides',
    crossArmRatio: 'Arm thickness',
    chevronDirection: 'Direction',
    directionRight: 'Right',
    directionLeft: 'Left',
    directionUp: 'Up',
    directionDown: 'Down',
    chevronNotchDepth: 'Tip depth',
    braceOrientation: 'Orientation',
    braceTipPosition: 'Tip position',
    braceCurvature: 'Curvature',
    bezierSymmetric: 'Symmetric',
  },
  canvas: {
    announceNoSelection: 'No object selected',
    announceSingleSelection: (type, id) => `Object ${type} selected (${id})`,
    announceMultiSelection: (count) => `${count} objects selected`,
    announceTool: (tool) => `Tool ${tool} activated`,
    announceZoom: (zoomPercent) => `Zoom changed to ${zoomPercent}%`,
    boardDefaultTitle: (n) => `Board ${n}`,
    boardTitleLabel: 'Board title',
    announceBoardSelection: (title) => `Board ${title} selected`,
  },
  controls: {
    historyLabel: 'History',
    undo: 'Undo',
    redo: 'Redo',
    zoomButton: (zoomPercent) => `Zoom: ${zoomPercent}%`,
    zoomMenu: 'Zoom options',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomTo100: 'Zoom to 100%',
    zoomToFit: 'Zoom to fit',
    zoomToSelection: 'Zoom to selection',
    help: 'Help and shortcuts',
    helpTitle: 'Keyboard shortcuts',
    close: 'Close',
    helpSectionEdit: 'Editing',
    helpSectionArrange: 'Arrange',
    helpSectionView: 'View',
    helpDelete: 'Delete the selection',
    helpEditText: 'Edit shape text',
    helpMove: 'Move the selection (with Shift, 10 px)',
    helpUndo: 'Undo',
    helpRedo: 'Redo',
    helpCancel: 'Cancel the gesture in progress',
    helpGroup: 'Group',
    helpUngroup: 'Ungroup',
    helpBringToFront: 'Bring to front',
    helpBringForward: 'Bring forward',
    helpSendBackward: 'Send backward',
    helpSendToBack: 'Send to back',
    helpPan: 'Move the view (hold and drag)',
    keySpace: 'Space',
  },
  shell: {
    menu: 'Menu',
    editTitle: (title) => `Edit title: ${title}`,
    untitled: 'Untitled',
    titleInput: 'Project title',
    share: 'Share',
    shareConnecting: 'Share, connecting',
    shareActive: 'Share, active',
    shareFailed: 'Could not start sharing',
    shareStop: 'Stop sharing',
    participants: (others) =>
      `Participants: ${others} other ${others === 1 ? 'person' : 'people'} in the session`,
    inSession: (total) => `In session (${total})`,
    you: '(you)',
    follow: 'Follow',
    following: 'Following',
    participantsDialog: 'Participants',
    followingBanner: (name) => `Following ${name}`,
    stopFollowing: 'Stop',
    followLeft: (name) => `${name} left; you stopped following`,
    followUnsupported: 'Version without follow support',
    shareStopPending: 'There are pending changes; sharing stays on',
    export: 'Export',
    exportMenu: 'Export options',
    exportSvg: 'Export SVG',
    exportPng: 'Export PNG',
    account: (name) => `Account: ${name}`,
  },
  selectionMenu: {
    toolbarLabel: 'Selection actions',
    bringToFront: 'Bring to front',
    sendToBack: 'Send to back',
    group: 'Group',
    ungroup: 'Ungroup',
    delete: 'Delete',
    exportBoard: 'Export board',
    exportBoardMenu: 'Board export options',
    exportBoardSvg: 'Export board as SVG',
    exportBoardPng: 'Export board as PNG',
  },
};

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends (...args: readonly never[]) => unknown
    ? T[P]
    : T[P] extends object
      ? DeepPartial<T[P]>
      : T[P];
};

let activeGlobalI18n: CanvashI18nMessages = { ...defaultI18nPtBR };

export function getGlobalI18n(): CanvashI18nMessages {
  return activeGlobalI18n;
}

export function setGlobalI18n(messages: DeepPartial<CanvashI18nMessages>): void {
  activeGlobalI18n = mergeI18n(activeGlobalI18n, messages);
}

export function resetGlobalI18n(): void {
  activeGlobalI18n = { ...defaultI18nPtBR };
}

export function mergeI18n(
  base: CanvashI18nMessages,
  override?: DeepPartial<CanvashI18nMessages>,
): CanvashI18nMessages {
  if (!override) return { ...base };
  return {
    toolbar: {
      ...base.toolbar,
      ...(override.toolbar || {}),
      // O objeto aninhado se mescla campo a campo, para uma troca parcial manter os outros nomes.
      islandAreas: { ...base.toolbar.islandAreas, ...(override.toolbar?.islandAreas || {}) },
    },
    layers: { ...base.layers, ...(override.layers || {}) },
    properties: { ...base.properties, ...(override.properties || {}) },
    canvas: { ...base.canvas, ...(override.canvas || {}) },
    controls: { ...base.controls, ...(override.controls || {}) },
    shell: { ...base.shell, ...(override.shell || {}) },
    selectionMenu: { ...base.selectionMenu, ...(override.selectionMenu || {}) },
  };
}
