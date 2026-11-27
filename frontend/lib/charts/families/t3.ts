// Lazy family chunk for T3 (experimental, CHARTS_EXPERIMENTAL only):
// geo/map. NOTE: the 3D / GL charts (bar3d, scatter3d, lines-gl) would need
// echarts-gl, which is deliberately NOT a dependency (large bundle against
// the 512 MB deploy limit); their builders refuse with an explicit reason
// instead of rendering half a feature.
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
import { GeoComponent, LegendComponent, TitleComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([MapChart, GeoComponent, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer]);
