import { Args, Mutation, Query, Resolver } from '@nestjs/graphql'
import { CartService } from './cart.service'

@Resolver()
export class ShoppingResolver {
  constructor(private readonly cart: CartService) {}
  @Query('priceCompare')
  async priceCompare(
    @Args('requirements') requirements: { name: string; requiredAmount: number; unit: string; category?: string }[]
  ) {
    return []
  }

  @Mutation('addMissingToCart')
  async addMissingToCart(@Args('recipeId') recipeId: string) {
    const items: any[] = []
    return this.cart.addMissing('u', items)
  }
}
