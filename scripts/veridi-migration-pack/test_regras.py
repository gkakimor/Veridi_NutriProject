"""Testes das regras de transformação: python -m unittest discover -s scripts/veridi-migration-pack"""

from __future__ import annotations

import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import fontes as F  # noqa: E402
import regras as R  # noqa: E402


class Documento(unittest.TestCase):
    def test_cnpj(self):
        self.assertTrue(R.cnpj_valido("11222333000181"))
        self.assertFalse(R.cnpj_valido("11222333000182"))
        self.assertFalse(R.cnpj_valido("11111111111111"))
        self.assertFalse(R.cnpj_valido("123"))
        self.assertEqual(R.formatar_cnpj("11222333000181"), "11.222.333/0001-81")


class Texto(unittest.TestCase):
    def test_marcador_de_vazio_nao_e_dado(self):
        for bruto in ("-", "**", "  ", None, "N/A"):
            self.assertEqual(R.limpar(bruto), "")
        self.assertEqual(R.limpar("0"), "0")
        self.assertEqual(R.limpar("0", zero_e_vazio=True), "")
        self.assertEqual(R.limpar("  Ácido   cítrico "), "Ácido cítrico")

    def test_normalizacao_de_nome_espelha_o_importador(self):
        self.assertEqual(R.normalizar_nome("Alta Comunicação"), "ALTA COMUNICACAO")
        self.assertEqual(R.normalizar_nome("INTERLAB/ANALITIC"), "INTERLAB ANALITIC")


class Chaves(unittest.TestCase):
    def test_formatos(self):
        self.assertEqual(R.chave_cliente("13"), "CLI-LEG-0013")
        self.assertEqual(R.chave_item("7"), "ITEM-LEG-0007")
        self.assertEqual(R.chave_produto("0001PL"), "PROD-LEG-0001PL")
        self.assertEqual(R.chave_item_pa("0001PL"), "PA-LEG-0001PL")
        self.assertEqual(R.chave_fornecedor("DOREMUS (amostra grátis)"), "FOR-LEG-DOREMUS-AMOSTRA-GRATIS")
        for chave in ("CLI-LEG-0013", "FOR-LEG-HL-CAPS", "ITEM-LEG-0645", "PROD-LEG-0001PL", "PA-LEG-0001V"):
            self.assertRegex(chave, R.PADRAO_CHAVE)
        self.assertNotRegex("9f1c2e3a-1b2c-4d5e-8f90-123456789abc", R.PADRAO_CHAVE)

    def test_oferta_deterministica(self):
        a = R.source_key_oferta("157", "HECAPLAST", "1.2", "1000")
        self.assertEqual(a, R.source_key_oferta("157", "Hecaplast", "1.2", "1000"))
        self.assertNotEqual(a, R.source_key_oferta("157", "HECAPLAST", "1.3", "1000"))
        self.assertRegex(R.chave_oferta(a), R.PADRAO_CHAVE)


class Endereco(unittest.TestCase):
    def test_padrao_completo(self):
        e = R.interpretar_endereco("Rua Vicente José de Almeida, n° 158, bairro Cupece")
        self.assertEqual((e["logradouro"], e["numero"], e["bairro"], e["revisar"]),
                         ("Rua Vicente José de Almeida", "158", "Cupece", False))

    def test_nao_afirma_o_que_nao_sabe(self):
        e = R.interpretar_endereco("Rodovia SP 330, Km 13")
        self.assertEqual(e["numero"], "")
        self.assertTrue(e["revisar"])
        e = R.interpretar_endereco("na Rua Almirante Abreu, nº201, bairro Rio Branco")
        self.assertEqual(e["logradouro"], "")
        self.assertEqual(e["numero"], "201")

    def test_cep_so_rotulado(self):
        self.assertEqual(R.extrair_cep("Rua X, nº 1, CEP: 18.285-000"), "18285-000")
        self.assertEqual(R.extrair_cep("AV. Y, 90 - SALA 402-LIBERDADE-CEP 35502634"), "35502-634")
        self.assertEqual(R.extrair_cep("Rua Z, 12345678"), "")
        self.assertEqual(R.sem_cep_no_fim("Monte Belo-CEP: 86.041-310"), "Monte Belo")


class EnderecoOpcional(unittest.TestCase):
    """Endereço de Cliente e Fornecedor: vazio é válido; preenchido tem regra."""

    def test_cep_espelha_o_runtime(self):
        self.assertTrue(R.cep_valido("13010-000"))
        self.assertTrue(R.cep_valido("13010000"))
        self.assertTrue(R.cep_valido("13.010-000"))
        self.assertFalse(R.cep_valido("1301"))
        self.assertFalse(R.cep_valido("130100000"))
        self.assertFalse(R.cep_valido(""))

    def test_uf_espelha_o_runtime(self):
        self.assertTrue(R.uf_valida("SP"))
        self.assertTrue(R.uf_valida("sp"))
        self.assertTrue(R.uf_valida(" DF "))
        self.assertFalse(R.uf_valida("XX"))
        self.assertFalse(R.uf_valida("CA"))
        self.assertFalse(R.uf_valida(""))

    def test_lista_de_uf_tem_as_27(self):
        self.assertEqual(len(R.UFS), 27)
        self.assertEqual(R.UFS, sorted(R.UFS))


class Item(unittest.TestCase):
    def test_familia(self):
        self.assertEqual(R.familia_do_pacote("MINERAIS"), ("MINERAL", True))
        self.assertEqual(R.familia_do_pacote("AMINOÁCIDO"), ("AMINOACIDO", True))
        self.assertEqual(R.familia_do_pacote("Embalagem"), ("EMBALAGEM", True))
        self.assertEqual(R.familia_do_pacote("SUBT BIOATIVAS"), ("OUTRA_MATERIA_PRIMA", False))
        self.assertEqual(R.familia_do_pacote(""), ("", True))

    def test_pureza(self):
        self.assertEqual(R.pureza_fracao("0.985"), (Decimal("0.985"), ""))
        self.assertEqual(R.pureza_fracao("**"), (None, ""))
        self.assertEqual(R.pureza_fracao("500.000UI/g"), (None, "500.000UI/g"))
        self.assertEqual(R.pureza_fracao("1.5"), (None, "1.5"))

    def test_pedido_minimo_espelha_o_importador(self):
        self.assertEqual(F.interpretar_pedido_minimo("500G"), (Decimal(500), "g"))
        self.assertEqual(F.interpretar_pedido_minimo("25"), (Decimal(25), None))
        self.assertEqual(F.interpretar_pedido_minimo("1 KG"), (Decimal(1), "kg"))
        self.assertIsNone(F.interpretar_pedido_minimo("1mil"))
        self.assertIsNone(F.interpretar_pedido_minimo("KG"))


class Semelhanca(unittest.TestCase):
    def test_pares_suspeitos(self):
        self.assertTrue(R.motivo_semelhanca("ACTIVE", "ACTIVE PHARMACEUTIC"))
        self.assertEqual(R.motivo_semelhanca("HL CAPS", "HLCAPS"), "mesmo nome sem espaços")
        self.assertEqual(R.motivo_semelhanca("FAGON", "FAGRON"), "grafia quase igual")
        self.assertEqual(R.motivo_semelhanca("DOREMUS", "DOREMUS (amostra grátis)"),
                         "mesmo nome sem a anotação entre parênteses")

    def test_nome_longo_aceita_duas_letras(self):
        self.assertEqual(R.motivo_semelhanca("PN FARMA", "pn pharma"), "grafia quase igual")
        self.assertEqual(R.motivo_semelhanca("ALISSUMOS", "ALLINSUMOS"), "grafia quase igual")

    def test_nao_junta_empresas_diferentes(self):
        self.assertEqual(R.motivo_semelhanca("HL CAPS", "INCAPS"), "")
        self.assertEqual(R.motivo_semelhanca("HECAPLAST", "HENRIPLAST"), "")
        self.assertEqual(R.motivo_semelhanca("MUNDIAL EMBALAGENS", "RANDON EMBALAGENS"), "")
        self.assertEqual(R.motivo_semelhanca("NEOVITA INGREDIENTES", "INGREDIENTES ONLINE"), "")


class Preco(unittest.TestCase):
    def test_normalizacao(self):
        self.assertEqual(R.normalizar_preco(Decimal("517.69"), Decimal(500), "g", "kg"), Decimal("1035.380000"))
        self.assertEqual(R.normalizar_preco(Decimal("1432.90"), Decimal(25), "kg", "kg"), Decimal("57.316000"))
        self.assertEqual(R.normalizar_preco(Decimal("25.00"), Decimal(100), "un", "un"), Decimal("0.250000"))
        self.assertIsNone(R.normalizar_preco(Decimal("10"), Decimal(1000), "un", "kg"))
        self.assertIsNone(R.normalizar_preco(Decimal("10"), Decimal(0), "g", "kg"))

    def test_memoria_explicita(self):
        texto = R.memoria_calculo(Decimal("517.69"), Decimal(500), "g", "kg", Decimal("1035.38"))
        self.assertEqual(texto, "R$ 517,69 ÷ 500 g × 1.000 g/kg = R$ 1.035,38/kg")

    def test_numero_brasileiro(self):
        self.assertEqual(R.br(Decimal("1035.38")), "1.035,38")
        self.assertEqual(R.br(Decimal("0.25"), 0), "0,25")
        self.assertEqual(R.br(Decimal(1000), 0), "1.000")

    def test_confianca(self):
        base = dict(grau="nao informado", unidade_estoque="kg", texto="", nome_item="Citrato de zinco")
        self.assertEqual(R.classificar_confianca(equivalencia="IGUAL", quantidade_em_unidade_estoque=Decimal(25), **base)[0], "ALTA")
        self.assertEqual(R.classificar_confianca(equivalencia="IGUAL", quantidade_em_unidade_estoque=Decimal("0.5"), **base)[0], "MEDIA")
        self.assertEqual(R.classificar_confianca(equivalencia="COMPARAVEL", quantidade_em_unidade_estoque=Decimal(25), **base)[0], "MEDIA")
        self.assertEqual(R.classificar_confianca(equivalencia="APROXIMADA", quantidade_em_unidade_estoque=Decimal(25), **base)[0], "BAIXA")
        pa = {**base, "grau": "PA"}
        self.assertEqual(R.classificar_confianca(equivalencia="IGUAL", quantidade_em_unidade_estoque=Decimal(1), **pa)[0], "MEDIA")
        generico = {**base, "nome_item": "VITAMINA"}
        self.assertEqual(R.classificar_confianca(equivalencia="IGUAL", quantidade_em_unidade_estoque=Decimal(1), **generico)[0], "BAIXA")
        substancia = {**base, "nome_item": "Taurina"}
        self.assertEqual(R.classificar_confianca(equivalencia="IGUAL", quantidade_em_unidade_estoque=Decimal(1), **substancia)[0], "ALTA")


class Referencia(unittest.TestCase):
    def test_mediana(self):
        self.assertEqual(R.mediana([Decimal(1), Decimal(3), Decimal(2)]), Decimal("2.000000"))
        self.assertEqual(R.mediana([Decimal(1), Decimal(2), Decimal(3), Decimal(4)]), Decimal("2.500000"))
        self.assertIsNone(R.mediana([]))

    def test_subtipo_pela_primeira_palavra(self):
        self.assertEqual(R.subtipo_sugerido("Pote HP1200BL Hecaplast (tampa CÓD 487)"), "POTE")
        self.assertEqual(R.subtipo_sugerido("ETIQUETA RÓTULO PARA SACHÊ"), "ROTULO")
        self.assertEqual(R.subtipo_sugerido("LACRE SLEEVE TRANSPARENTE TAMPA"), "SELO")
        self.assertEqual(R.subtipo_sugerido("STAND UP POUCH 1KG (30X46)"), "SACHE_POUCH")
        self.assertEqual(R.subtipo_sugerido("Lata de Papel Multifoliada e Tampa (73x111)"), "OUTRO")
        self.assertEqual(R.subtipo_sugerido("SÍLICA GEL BRANCA EM CÁPSULA SG"), "")


class Sintetico(unittest.TestCase):
    def test_varredura(self):
        self.assertTrue(R.PADRAO_SINTETICO_CERTO.search("EXEMPLO — Recurso industrial"))
        self.assertEqual(R.marcador_sintetico("Cloreto de zinco"), "")
        self.assertEqual(R.marcador_sintetico("Cliente Teste"), "Teste")


if __name__ == "__main__":
    unittest.main()
