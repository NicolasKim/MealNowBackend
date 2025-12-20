import { Module } from '@nestjs/common'
import { ShoppingResolver } from './shopping.resolver'
import { CartService } from './cart.service'

@Module({ providers: [ShoppingResolver, CartService] })
export class ShoppingModule {}
