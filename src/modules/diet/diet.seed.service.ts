import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { Model } from 'mongoose'
import { NutrientBenefits, NutrientDefinition, NutrientDefinitionDocument } from './schemas/nutrient-definition.schema'

@Injectable()
export class DietSeedService implements OnModuleInit {
  private readonly logger = new Logger(DietSeedService.name)

  private readonly CATEGORY_NAME_BY_CATEGORY: Record<string, Record<string, string>> = {
    macronutrient: { en: 'Macronutrients', zh: '宏量营养素' },
    vitamins: { en: 'Vitamins', zh: '维生素' },
    minerals: { en: 'Minerals', zh: '矿物质' },
    fiber: { en: 'Dietary Fiber', zh: '膳食纤维' },
  }

  private readonly NUTRIENT_DEFINITIONS: Array<{
    type: string
    category: string
    categoryName: Record<string, string>
    name: Record<string, string>
    benefits: NutrientBenefits
    unit: string
    lowerRecommendedIntake: number
    upperRecommendedIntake: number
    categoryOrder: number
    typeOrder: number
  }> = [
    {
      type: 'carbohydrate',
      category: 'macronutrient',
      categoryOrder: 1,
      typeOrder: 1,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.macronutrient,
      name: { en: 'Carbohydrate', zh: '碳水化合物' },
      benefits: {
        efficacy: {
          en: 'Primary energy source for body and brain; supports performance.',
          zh: '主要能量来源，支持身体活动与大脑功能。',
        },
        deficiency: {
          en: 'Low intake may cause fatigue, poor focus and reduced exercise capacity.',
          zh: '摄入不足可能导致疲劳、注意力下降、运动表现变差。',
        },
        excess: {
          en: 'Excess intake may contribute to weight gain and blood sugar fluctuations.',
          zh: '摄入过量可能增加体重风险，并造成血糖波动。',
        },
      },
      unit: 'g',
      lowerRecommendedIntake: 250,
      upperRecommendedIntake: 350,
    },
    {
      type: 'protein',
      category: 'macronutrient',
      categoryOrder: 1,
      typeOrder: 2,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.macronutrient,
      name: { en: 'Protein', zh: '蛋白质' },
      benefits: {
        efficacy: {
          en: 'Supports muscle maintenance, tissue repair and immune function.',
          zh: '支持肌肉维持、组织修复与免疫功能。',
        },
        deficiency: {
          en: 'Insufficient intake may lead to muscle loss, slower recovery and poor immunity.',
          zh: '摄入不足可能导致肌肉流失、恢复变慢、免疫力下降。',
        },
        excess: {
          en: 'Excess intake may increase kidney burden in susceptible individuals and add extra calories.',
          zh: '摄入过量在特定人群可能增加肾脏负担，也会带来额外热量。',
        },
      },
      unit: 'g',
      lowerRecommendedIntake: 50,
      upperRecommendedIntake: 70,
    },
    {
      type: 'fat',
      category: 'macronutrient',
      categoryOrder: 1,
      typeOrder: 3,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.macronutrient,
      name: { en: 'Fat', zh: '脂肪' },
      benefits: {
        efficacy: {
          en: 'Supports hormones, cell membranes, and absorption of fat-soluble vitamins.',
          zh: '支持激素合成、细胞膜结构与脂溶性维生素吸收。',
        },
        deficiency: {
          en: 'Too little fat may impair fat-soluble vitamin absorption and hormone balance.',
          zh: '摄入过少可能影响脂溶性维生素吸收与激素平衡。',
        },
        excess: {
          en: 'Excess fat, especially saturated/trans fats, may raise cardiovascular risk and promote weight gain.',
          zh: '摄入过量（尤其饱和/反式脂肪）可能增加心血管风险并促进体重增加。',
        },
      },
      unit: 'g',
      lowerRecommendedIntake: 60,
      upperRecommendedIntake: 80,
    },
    {
      type: 'vitamin_a',
      category: 'vitamins',
      categoryOrder: 2,
      typeOrder: 1,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.vitamins,
      name: { en: 'Vitamin A', zh: '维生素A' },
      benefits: {
        efficacy: {
          en: 'Supports vision (especially night vision), skin integrity and immune function.',
          zh: '支持视力（尤其夜视）、皮肤黏膜屏障与免疫功能。',
        },
        deficiency: {
          en: 'Deficiency may cause night blindness, dry eyes/skin and increased infection risk.',
          zh: '摄入不足可能导致夜盲、眼干/皮肤干燥，并增加感染风险。',
        },
        excess: {
          en: 'Excess (preformed vitamin A) may cause liver toxicity and headaches; avoid high-dose supplementation.',
          zh: '摄入过量（视黄醇类）可能引起肝毒性、头痛等，应避免大剂量补充。',
        },
      },
      unit: 'µg',
      lowerRecommendedIntake: 700,
      upperRecommendedIntake: 900,
    },
    {
      type: 'vitamin_d',
      category: 'vitamins',
      categoryOrder: 2,
      typeOrder: 2,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.vitamins,
      name: { en: 'Vitamin D', zh: '维生素D' },
      benefits: {
        efficacy: {
          en: 'Supports calcium absorption, bone health and muscle function.',
          zh: '促进钙吸收，支持骨骼健康与肌肉功能。',
        },
        deficiency: {
          en: 'Low intake may weaken bones and increase fracture risk.',
          zh: '摄入不足可能导致骨骼变弱，增加骨折风险。',
        },
        excess: {
          en: 'Excess may cause high blood calcium, kidney stones and nausea.',
          zh: '摄入过量可能导致高钙血症、肾结石及恶心等问题。',
        },
      },
      unit: 'µg',
      lowerRecommendedIntake: 15,
      upperRecommendedIntake: 20,
    },
    {
      type: 'vitamin_c',
      category: 'vitamins',
      categoryOrder: 2,
      typeOrder: 3,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.vitamins,
      name: { en: 'Vitamin C', zh: '维生素C' },
      benefits: {
        efficacy: {
          en: 'Supports antioxidant defense, collagen synthesis and immune function.',
          zh: '支持抗氧化防御、胶原蛋白合成与免疫功能。',
        },
        deficiency: {
          en: 'Deficiency may cause gum bleeding, poor wound healing and fatigue.',
          zh: '摄入不足可能导致牙龈出血、伤口愈合差、疲劳等。',
        },
        excess: {
          en: 'Excess may cause gastrointestinal discomfort; high doses may increase kidney stone risk in some people.',
          zh: '摄入过量可能引起胃肠不适；大剂量在部分人群可能增加肾结石风险。',
        },
      },
      unit: 'mg',
      lowerRecommendedIntake: 75,
      upperRecommendedIntake: 90,
    },
    {
      type: 'vitamin_e',
      category: 'vitamins',
      categoryOrder: 2,
      typeOrder: 4,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.vitamins,
      name: { en: 'Vitamin E', zh: '维生素E' },
      benefits: {
        efficacy: {
          en: 'Antioxidant that helps protect cells from oxidative damage.',
          zh: '抗氧化，帮助保护细胞免受氧化损伤。',
        },
        deficiency: {
          en: 'Deficiency is uncommon but may cause nerve and muscle problems.',
          zh: '缺乏较少见，但可能出现神经与肌肉相关问题。',
        },
        excess: {
          en: 'Excess supplementation may increase bleeding risk, especially with anticoagulants.',
          zh: '补充过量可能增加出血风险，尤其与抗凝药同用时。',
        },
      },
      unit: 'mg',
      lowerRecommendedIntake: 10,
      upperRecommendedIntake: 15,
    },
    {
      type: 'vitamin_k',
      category: 'vitamins',
      categoryOrder: 2,
      typeOrder: 5,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.vitamins,
      name: { en: 'Vitamin K', zh: '维生素K' },
      benefits: {
        efficacy: {
          en: 'Supports normal blood clotting and bone metabolism.',
          zh: '支持正常凝血功能与骨代谢。',
        },
        deficiency: {
          en: 'Deficiency may increase bleeding tendency and bruising.',
          zh: '摄入不足可能增加出血倾向与淤青。',
        },
        excess: {
          en: 'High intake may interfere with certain anticoagulant medications (e.g., warfarin).',
          zh: '摄入过多可能影响部分抗凝药（如华法林）效果。',
        },
      },
      unit: 'µg',
      lowerRecommendedIntake: 90,
      upperRecommendedIntake: 120,
    },
    {
      type: 'vitamin_b',
      category: 'vitamins',
      categoryOrder: 2,
      typeOrder: 6,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.vitamins,
      name: { en: 'Vitamin B Complex', zh: '维生素B族' },
      benefits: {
        efficacy: {
          en: 'Supports energy metabolism, red blood cell formation and nervous system function.',
          zh: '支持能量代谢、红细胞生成与神经系统功能。',
        },
        deficiency: {
          en: 'Deficiency may cause fatigue, mouth sores and nerve-related symptoms.',
          zh: '摄入不足可能导致疲劳、口腔溃疡及神经相关症状。',
        },
        excess: {
          en: 'Excess supplementation of some B vitamins may cause nerve issues or flushing in sensitive individuals.',
          zh: '部分B族维生素补充过量在敏感人群可能引起神经不适或潮红等。',
        },
      },
      unit: 'mg',
      lowerRecommendedIntake: 5,
      upperRecommendedIntake: 10,
    },
    {
      type: 'calcium',
      category: 'minerals',
      categoryOrder: 3,
      typeOrder: 1,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.minerals,
      name: { en: 'Calcium', zh: '钙' },
      benefits: {
        efficacy: {
          en: 'Supports bones and teeth, muscle contraction and nerve signaling.',
          zh: '支持骨骼牙齿、肌肉收缩与神经传导。',
        },
        deficiency: {
          en: 'Low intake may reduce bone density and increase fracture risk over time.',
          zh: '长期摄入不足可能降低骨密度并增加骨折风险。',
        },
        excess: {
          en: 'Excess may cause constipation and increase kidney stone risk in some people.',
          zh: '摄入过量可能导致便秘，并在部分人群增加肾结石风险。',
        },
      },
      unit: 'mg',
      lowerRecommendedIntake: 1000,
      upperRecommendedIntake: 1200,
    },
    {
      type: 'magnesium',
      category: 'minerals',
      categoryOrder: 3,
      typeOrder: 2,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.minerals,
      name: { en: 'Magnesium', zh: '镁' },
      benefits: {
        efficacy: {
          en: 'Supports muscle and nerve function and energy production.',
          zh: '支持肌肉与神经功能，并参与能量生成。',
        },
        deficiency: {
          en: 'Deficiency may cause muscle cramps, weakness and abnormal heart rhythm.',
          zh: '摄入不足可能出现肌肉抽筋、乏力及心律异常。',
        },
        excess: {
          en: 'Excess from supplements may cause diarrhea; very high intake can affect heart rhythm.',
          zh: '补充过量可能导致腹泻；极高摄入可能影响心律。',
        },
      },
      unit: 'mg',
      lowerRecommendedIntake: 310,
      upperRecommendedIntake: 420,
    },
    {
      type: 'sodium',
      category: 'minerals',
      categoryOrder: 3,
      typeOrder: 3,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.minerals,
      name: { en: 'Sodium', zh: '钠' },
      benefits: {
        efficacy: {
          en: 'Helps maintain fluid balance and supports nerve and muscle function.',
          zh: '维持体液平衡，支持神经与肌肉功能。',
        },
        deficiency: {
          en: 'Too little sodium may cause dizziness, nausea and low blood pressure (rare without heavy sweating).',
          zh: '摄入过少可能导致头晕、恶心、低血压（通常见于大量出汗/特殊情况）。',
        },
        excess: {
          en: 'Excess sodium may raise blood pressure and increase cardiovascular risk.',
          zh: '摄入过量可能升高血压并增加心血管风险。',
        },
      },
      unit: 'mg',
      lowerRecommendedIntake: 1500,
      upperRecommendedIntake: 2300,
    },
    {
      type: 'phosphorus',
      category: 'minerals',
      categoryOrder: 3,
      typeOrder: 4,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.minerals,
      name: { en: 'Phosphorus', zh: '磷' },
      benefits: {
        efficacy: {
          en: 'Supports bones/teeth and is essential for energy production (ATP).',
          zh: '支持骨骼牙齿健康，并参与能量生成（ATP）。',
        },
        deficiency: {
          en: 'Deficiency is uncommon but may cause weakness and bone discomfort.',
          zh: '缺乏较少见，但可能导致乏力与骨骼不适。',
        },
        excess: {
          en: 'Excess may affect calcium balance and is a concern for people with kidney disease.',
          zh: '摄入过量可能影响钙平衡，肾病人群需特别关注。',
        },
      },
      unit: 'mg',
      lowerRecommendedIntake: 700,
      upperRecommendedIntake: 1250,
    },
    {
      type: 'iron',
      category: 'minerals',
      categoryOrder: 3,
      typeOrder: 5,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.minerals,
      name: { en: 'Iron', zh: '铁' },
      benefits: {
        efficacy: {
          en: 'Essential for hemoglobin and oxygen transport; supports energy and cognition.',
          zh: '参与血红蛋白与携氧，支持精力与认知表现。',
        },
        deficiency: {
          en: 'Deficiency may lead to iron-deficiency anemia, fatigue and reduced exercise tolerance.',
          zh: '摄入不足可能导致缺铁性贫血、疲劳与运动耐受下降。',
        },
        excess: {
          en: 'Excess may cause gastrointestinal issues and, in high amounts, organ damage; avoid high-dose supplements unless needed.',
          zh: '摄入过量可能引起胃肠不适；长期高摄入可损害器官，应避免无必要的大剂量补铁。',
        },
      },
      unit: 'mg',
      lowerRecommendedIntake: 8,
      upperRecommendedIntake: 18,
    },
    {
      type: 'zinc',
      category: 'minerals',
      categoryOrder: 3,
      typeOrder: 6,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.minerals,
      name: { en: 'Zinc', zh: '锌' },
      benefits: {
        efficacy: {
          en: 'Supports immune function, wound healing and taste/smell.',
          zh: '支持免疫功能、伤口愈合与味觉嗅觉。',
        },
        deficiency: {
          en: 'Deficiency may cause poor wound healing, hair loss and reduced immunity.',
          zh: '摄入不足可能导致伤口愈合差、脱发与免疫力下降。',
        },
        excess: {
          en: 'Excess may cause nausea and can reduce copper absorption over time.',
          zh: '摄入过量可能导致恶心，长期可影响铜吸收。',
        },
      },
      unit: 'mg',
      lowerRecommendedIntake: 8,
      upperRecommendedIntake: 11,
    },
    {
      type: 'copper',
      category: 'minerals',
      categoryOrder: 3,
      typeOrder: 7,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.minerals,
      name: { en: 'Copper', zh: '铜' },
      benefits: {
        efficacy: {
          en: 'Supports iron metabolism, connective tissue formation and antioxidant enzymes.',
          zh: '支持铁代谢、结缔组织形成与抗氧化酶功能。',
        },
        deficiency: {
          en: 'Deficiency may cause anemia-like symptoms and reduced immune function.',
          zh: '摄入不足可能出现类似贫血症状并影响免疫功能。',
        },
        excess: {
          en: 'Excess may cause nausea and, in high amounts, liver damage.',
          zh: '摄入过量可能导致恶心；长期高摄入可损伤肝脏。',
        },
      },
      unit: 'mg',
      lowerRecommendedIntake: 0.9,
      upperRecommendedIntake: 2,
    },
    {
      type: 'manganese',
      category: 'minerals',
      categoryOrder: 3,
      typeOrder: 8,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.minerals,
      name: { en: 'Manganese', zh: '锰' },
      benefits: {
        efficacy: {
          en: 'Supports metabolism and antioxidant enzyme function.',
          zh: '支持代谢过程与抗氧化酶功能。',
        },
        deficiency: {
          en: 'Deficiency is rare but may affect growth and bone health.',
          zh: '缺乏较少见，但可能影响生长与骨骼健康。',
        },
        excess: {
          en: 'Excess (especially from supplements) may affect the nervous system.',
          zh: '摄入过量（尤其补充剂）可能影响神经系统。',
        },
      },
      unit: 'mg',
      lowerRecommendedIntake: 1.8,
      upperRecommendedIntake: 2.3,
    },
    {
      type: 'fiber',
      category: 'fiber',
      categoryOrder: 4,
      typeOrder: 1,
      categoryName: this.CATEGORY_NAME_BY_CATEGORY.fiber,
      name: { en: 'Dietary Fiber', zh: '膳食纤维' },
      benefits: {
        efficacy: {
          en: 'Supports digestive health, satiety and healthy blood sugar and cholesterol.',
          zh: '支持肠道健康、增强饱腹感，并有助于血糖与胆固醇管理。',
        },
        deficiency: {
          en: 'Low intake may cause constipation and reduced satiety.',
          zh: '摄入不足可能导致便秘、饱腹感下降。',
        },
        excess: {
          en: 'Too much fiber too quickly may cause bloating and interfere with mineral absorption.',
          zh: '短期大量增加可能引起腹胀不适，并影响部分矿物质吸收。',
        },
      },
      unit: 'g',
      lowerRecommendedIntake: 25,
      upperRecommendedIntake: 30,
    },
  ]

  constructor(
    @InjectModel(NutrientDefinition.name)
    private readonly nutrientDefinitionModel: Model<NutrientDefinitionDocument>
  ) {}

  async onModuleInit() {
    await this.seedNutrients()
  }

  private async seedNutrients() {
    try {
      const operations = this.NUTRIENT_DEFINITIONS.map((n) => ({
        updateOne: {
          filter: { type: n.type },
          update: { $set: n },
          upsert: true,
        },
      }))

      await this.nutrientDefinitionModel.bulkWrite(operations)
      this.logger.log(`Nutrient definitions seeded/updated: ${this.NUTRIENT_DEFINITIONS.length}`)
    } catch (error: any) {
      this.logger.error(`Failed to seed nutrient definitions: ${error?.message || String(error)}`, error?.stack)
    }
  }
}
